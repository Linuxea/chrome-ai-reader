/**
 * F11 — agent mode tools. The model (via the worker's tool loop) may call
 * these; they run here in the side panel, where the page, the selection and
 * the other tabs are reachable. All are read-only except the harmless
 * `highlight_paragraph` (scrolls/flashes the page).
 *
 * Results are plain text for the model. Failures return an explanation
 * rather than throwing, so the model can adapt.
 */

import * as state from '../state';
import { scoreParagraphs, splitParagraphs } from '../../shared/context-builder';
import { sendToContentScript } from '../../platform/messaging';
import { extractTabContent } from './page-extractor';

export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> =>
  ({ type: 'object', properties, required, additionalProperties: false });

export const AGENT_TOOL_SPECS: AgentToolSpec[] = [
  {
    name: 'search_page',
    description: 'Search the current page for paragraphs relevant to a query. Returns up to 6 paragraphs as "[#N] text". Use it when the provided context says the article is partial, or to find specific details.',
    parameters: obj({ query: { type: 'string', description: 'What to look for (keywords or a question).' } }, ['query']),
  },
  {
    name: 'read_paragraphs',
    description: 'Read a range of paragraphs of the current page by label, e.g. start=10 end=20. At most 30 paragraphs per call.',
    parameters: obj({ start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } }, ['start', 'end']),
  },
  {
    name: 'get_selection',
    description: 'Get the text the user currently has selected on the page (empty if none).',
    parameters: obj({}),
  },
  {
    name: 'list_open_tabs',
    description: 'List the tabs open in the user\'s current browser window (id, title, URL).',
    parameters: obj({}),
  },
  {
    name: 'read_tab',
    description: 'Read the main text of another open tab (by id from list_open_tabs). Long pages are truncated.',
    parameters: obj({ tab_id: { type: 'integer' } }, ['tab_id']),
  },
  {
    name: 'highlight_paragraph',
    description: 'Scroll the page to paragraph [#N] and highlight it for the user.',
    parameters: obj({ index: { type: 'integer', minimum: 0 } }, ['index']),
  },
];

/** Max characters of a tool result handed back to the model. */
const RESULT_LIMIT = 12_000;

function paragraphsOf(tabId: number): string[] {
  const ts = state.getStateForTab(tabId);
  if (!ts) return [];
  return ts.pageParagraphs?.length ? ts.pageParagraphs : splitParagraphs(ts.pageContent || '');
}

type Args = Record<string, unknown>;
type Tool = (args: Args, tabId: number) => Promise<string>;

const TOOLS: Record<string, Tool> = {
  async search_page(args, tabId) {
    const paras = paragraphsOf(tabId);
    if (!paras.length) return 'The page has not been read yet or has no text.';
    const scores = scoreParagraphs(paras, String(args.query ?? ''));
    const top = scores.map((s, i) => [s, i] as const).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 6);
    if (!top.length) return 'No paragraph matches that query.';
    return top.sort((a, b) => a[1] - b[1]).map(([, i]) => `[#${i}] ${paras[i]}`).join('\n\n');
  },

  async read_paragraphs(args, tabId) {
    const paras = paragraphsOf(tabId);
    const start = Math.max(0, Number(args.start) || 0);
    const end = Math.min(paras.length - 1, Number(args.end) || start, start + 29);
    if (!paras.length || start >= paras.length) return `The page has ${paras.length} paragraphs (#0–#${Math.max(0, paras.length - 1)}).`;
    return paras.slice(start, end + 1).map((p, k) => `[#${start + k}] ${p}`).join('\n\n');
  },

  async get_selection(_args, tabId) {
    const text = state.getStateForTab(tabId)?.selectedText ?? '';
    return text ? text : 'Nothing is selected.';
  },

  async list_open_tabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.map((t) => `${t.id}: ${t.title ?? ''} — ${t.url ?? ''}`).join('\n') || 'No tabs.';
  },

  async read_tab(args) {
    const id = Number(args.tab_id);
    if (!Number.isInteger(id)) return 'tab_id must be an integer from list_open_tabs.';
    const res = await extractTabContent(id);
    if (!res.ok) return `Could not read that tab: ${res.error.message}`;
    return `Title: ${res.value.title}\n\n${res.value.textContent}`;
  },

  async highlight_paragraph(args, tabId) {
    const text = paragraphsOf(tabId)[Number(args.index)];
    if (!text) return 'No such paragraph.';
    try {
      const res = await sendToContentScript<{ ok?: boolean }>(tabId, { action: 'highlightParagraph', text });
      return res?.ok ? `Highlighted paragraph #${args.index}.` : 'Paragraph not found on the live page.';
    } catch {
      return 'This page cannot be highlighted.';
    }
  },
};

/** Run one tool call; never throws. */
export async function runAgentTool(name: string, argsJson: string, tabId: number): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) return `Unknown tool "${name}".`;
  let args: Args;
  try {
    args = argsJson ? JSON.parse(argsJson) as Args : {};
  } catch {
    return 'Invalid arguments: expected a JSON object.';
  }
  try {
    const out = await tool(args, tabId);
    return out.length > RESULT_LIMIT ? out.slice(0, RESULT_LIMIT) + '\n[truncated]' : out;
  } catch (e) {
    return `Tool failed: ${(e as Error).message}`;
  }
}
