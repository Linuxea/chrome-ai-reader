/**
 * Agent tool registry for the service worker. Each tool wraps an existing
 * SW capability (content-script extraction, page-record search, OCR) behind
 * a zod-validated schema the model can call.
 *
 * Contract:
 *  - execute() ALWAYS resolves to a string (LLM-readable). Failures are
 *    returned as error descriptions, never thrown — the model sees the
 *    failure and can adjust, instead of the whole agent run dying.
 *  - every call is raced against TOOL_TIMEOUT_MS so a hung chrome.* or
 *    network call cannot stall the loop (each port message resets the SW
 *    idle timer, but a silent tool could still outlive it).
 */

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { fetchEmbeddingVector } from './embedding';
import { searchByEmbedding } from '../sw-related-pages';
import { handleOcrParse } from '../sw-ocr';

const TOOL_TIMEOUT_MS = 25_000;
/** Soft cap on read_page output so one huge page can't eat the whole context window. */
const PAGE_TEXT_CAP = 15_000;

export const TOOL_NAMES = {
  READ_PAGE: 'read_page',
  FIND_RELATED_PAGES: 'find_related_pages',
  OCR_IMAGE: 'ocr_image',
} as const;

function withTimeout<T>(promise: Promise<T>, ms = TOOL_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`tool timed out after ${ms}ms`)), ms)),
  ]);
}

async function runTool(name: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await withTimeout(fn());
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return `Error: tool ${name} failed: ${message}`;
  }
}

async function resolveTabId(tabId?: number): Promise<number> {
  if (typeof tabId === 'number') return tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('no active tab');
  return tab.id;
}

async function extractPage(tabId?: number): Promise<string> {
  const id = await resolveTabId(tabId);
  const response = (await chrome.tabs.sendMessage(id, { action: 'extract' })) as {
    success?: boolean;
    error?: string;
    data?: { title: string; textContent: string };
  };
  if (!response?.success) throw new Error(response?.error || 'content script extraction failed');
  const { title, textContent } = response.data!;
  const clipped = textContent.length > PAGE_TEXT_CAP
    ? `${textContent.slice(0, PAGE_TEXT_CAP)}\n…[truncated, ${textContent.length - PAGE_TEXT_CAP} chars omitted]`
    : textContent;
  return JSON.stringify({ title, textContent: clipped });
}

/** Default recall cutoff when the user hasn't configured embeddingThreshold (same default as the related-pages panel feature). */
const THRESHOLD_DEFAULT = 0.7;

async function findRelatedPages(query: string, limit: number): Promise<string> {
  const embedding = await fetchEmbeddingVector(query);
  const { embeddingThreshold } = (await chrome.storage.sync.get('embeddingThreshold')) as { embeddingThreshold?: number };
  const threshold = typeof embeddingThreshold === 'number' ? embeddingThreshold : THRESHOLD_DEFAULT;
  const relations = await searchByEmbedding(embedding, threshold, Math.min(limit, 10));
  return JSON.stringify(
    relations.map(({ record, similarity }) => ({
      title: record.title,
      url: record.url,
      excerpt: record.excerpt,
      similarity: Number(similarity.toFixed(3)),
    })),
  );
}

function ocrParse(imageBase64: string): Promise<{ success: boolean; data?: unknown; error?: string; errorKey?: string }> {
  return new Promise((resolve) => {
    handleOcrParse({ file: imageBase64 }, (r) => resolve(r as { success: boolean; data?: unknown; error?: string; errorKey?: string }));
  });
}

async function ocrImage(imageBase64: string): Promise<string> {
  const bare = imageBase64.replace(/^data:[^,]+,/, '');
  const result = await ocrParse(bare);
  if (!result.success) throw new Error(result.error || result.errorKey || 'OCR failed');
  return JSON.stringify(result.data);
}

/** The full registry. `getEnabledTools` filters it by the options-page toggles. */
export const ALL_TOOLS: ToolSet = {
  [TOOL_NAMES.READ_PAGE]: tool({
    description:
      'Extract the readable main content (title + body text) of a browser tab. ' +
      'Omit tabId to use the currently active tab.',
    inputSchema: z.object({ tabId: z.number().int().optional().describe('Target tab id; defaults to the active tab') }),
    execute: async ({ tabId }) => runTool(TOOL_NAMES.READ_PAGE, () => extractPage(tabId)),
  }),
  [TOOL_NAMES.FIND_RELATED_PAGES]: tool({
    description:
      'Search the user previously-read pages (stored locally, ranked by semantic similarity to the query) ' +
      'to recall related reading. Requires the embedding provider to be configured.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Free-text query to embed and rank stored pages against'),
      limit: z.number().int().min(1).max(10).default(5).describe('Max number of pages to return'),
    }),
    execute: async ({ query, limit }) => runTool(TOOL_NAMES.FIND_RELATED_PAGES, () => findRelatedPages(query, limit ?? 5)),
  }),
  [TOOL_NAMES.OCR_IMAGE]: tool({
    description:
      'Run OCR on a base64-encoded image to extract its text (e.g. scanned pages, diagrams with labels). ' +
      'Requires the OCR provider key to be configured.',
    inputSchema: z.object({
      imageBase64: z.string().min(8).describe('Base64 image data; a data: URI prefix is accepted and stripped'),
    }),
    execute: async ({ imageBase64 }) => runTool(TOOL_NAMES.OCR_IMAGE, () => ocrImage(imageBase64)),
  }),
};

/** Subset of ALL_TOOLS whose names appear in `enabled` (unknown names ignored). Empty array → {}. */
export function getEnabledTools(enabled: string[] | undefined): ToolSet {
  const set = new Set(enabled || []);
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(ALL_TOOLS)) {
    if (set.has(name)) out[name] = t;
  }
  return out;
}
