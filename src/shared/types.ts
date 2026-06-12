/**
 * Central TypeScript type definitions for the chrome-ai-reader project.
 *
 * These types serve as a living contract for state shapes and data structures.
 * Gradually replaces the JSDoc types in types.js as files migrate to TypeScript.
 *
 * Usage in TS modules:
 *   import type { ChatMessage, TabState } from '../shared/types';
 *
 * Usage in JS modules (JSDoc IntelliSense still works via types.js):
 *   /** @type {ChatMessage} * /
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  type?: string;
}

export interface TabState {
  pageContent: string;
  pageTitle: string;
  pageExcerpt: string;
  conversationHistory: ChatMessage[];
  currentChatId: string | null;
  selectedText: string;
  isGenerating: boolean;
  isPodcastGenerating: boolean;
  isChartGenerating: boolean;
  detectedCharts: ChartInfo[];
  ocrRunning: number;
  ocrResults: OcrResult[];
  imageIndex: number;
}

export interface ChartInfo {
  type: string;
  index: number;
  width: number;
  height: number;
  thumbnail?: string;
  src?: string;
  pageX: number;
  pageY: number;
  pageW: number;
  pageH: number;
}

export interface OcrResult {
  index: number;
  fileName: string;
  text: string;
}

/**
 * Discriminated union for explicit error handling without exceptions.
 * Use for "expected failure" scenarios: parsing, validation, external data fetch.
 * Do NOT use for truly unexpected errors (DOM crashes, programming bugs).
 *
 * Helper functions ok()/err() are in result.js — import from there for value imports.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface PageRecord {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  embedding: number[];
  timestamp: number;
}

export interface PageRelation {
  record: PageRecord;
  similarity: number;
}
