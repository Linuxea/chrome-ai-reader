/**
 * Wire-protocol type contracts for the extension's `chrome.runtime` Port and
 * one-shot message channels.
 *
 * Why this exists: the streaming Port protocols (ai-chat, tts, suggest, …) were
 * previously declared inline at each call site — e.g. the `StreamMessage`
 * interface lived inside `stream-handler.ts` and the background side posted
 * plain objects. That made the wire contract implicit and let the two sides
 * drift. This module is the single source of truth for the message shapes
 * exchanged between the side panel / content script and the background worker.
 *
 * Port name constants live in `PORT_NAMES` below; pair each with its
 * request/response message types. Background handlers and clients must both
 * import from here.
 *
 * Reserved-for-future (agent) message kinds are declared but commented out —
 * see Phase 6 of the refactor plan. They are intentionally NOT wired yet.
 */

import type { ChatMessage, PageRecord, PageRelation } from './types';

// ---------------------------------------------------------------------------
// Port names — the single registry of long-lived `chrome.runtime.connect` ports
// ---------------------------------------------------------------------------

export const PORT_NAMES = {
  AI_CHAT: 'ai-chat',
  TTS: 'tts',
  TTS_DOWNLOAD: 'tts-download',
  SUGGEST_QUESTIONS: 'suggest-questions',
  PODCAST_LLM: 'podcast-llm',
  PODCAST_AUDIO: 'podcast-audio',
  EMBEDDING: 'embedding',
  ANNOTATION: 'annotation',
} as const;

export type PortName = (typeof PORT_NAMES)[keyof typeof PORT_NAMES];

/** Optional OpenAI-style response_format constraint, passed through to the SW. */
export interface ResponseFormat {
  type: 'json_object' | 'text';
}

// ---------------------------------------------------------------------------
// ai-chat port — generic streaming chat completion
// ---------------------------------------------------------------------------

/** Request posted TO the background on the ai-chat port. */
export interface AIChatRequest {
  type: 'chat';
  messages: ChatMessage[];
  response_format?: ResponseFormat;
}

/** Streaming messages posted FROM the background on the ai-chat (and any
 *  text-streaming) port. Same shape is reused by suggest-questions & podcast-llm. */
export type StreamMessage =
  | { type: 'thinking'; content: string }
  | { type: 'chunk'; content: string }
  | { type: 'done' }
  | { type: 'error'; error?: string; errorKey?: string };
// Reserved for agent evolution (Phase 6 — not wired yet):
//   | { type: 'tool_call'; tool_call_id: string; name: string; arguments: string }
//   | { type: 'tool_result'; tool_call_id: string; content: string }

// ---------------------------------------------------------------------------
// suggest-questions port
// ---------------------------------------------------------------------------

export interface SuggestRequest {
  type: 'suggest';
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// tts / tts-download ports (352 = audio chunk, 152 = finish, 153 = failure)
// ---------------------------------------------------------------------------

export interface TTSRequest {
  type: 'tts';
  text: string;
}

export type TTSMessage =
  | { type: '352'; text: string; sequence: number; base64: string }
  | { type: '152'; text: string }
  | { type: '153'; text: string };

// ---------------------------------------------------------------------------
// podcast-llm port — JSON-mode script + title/description generation
// ---------------------------------------------------------------------------

export interface PodcastLLMRequest {
  type: 'generate';
  prompt: string;
  text: string;
}

// ---------------------------------------------------------------------------
// podcast-audio port
// ---------------------------------------------------------------------------

export interface PodcastNLPText {
  speaker: string;
  text: string;
}

export interface PodcastAudioConfig {
  format: string;
  sample_rate: number;
  speech_rate: number;
}

export interface PodcastAudioRequest {
  type: 'generate';
  nlpTexts: PodcastNLPText[];
  audioConfig: PodcastAudioConfig;
}

// ---------------------------------------------------------------------------
// embedding port
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  type: 'embed';
  text: string;
}

export interface EmbeddingMessage {
  type: 'embedding';
  embedding: number[];
}

export interface EmbeddingErrorMessage {
  type: 'error';
  /** Free-text error message (e.g. network failure detail). */
  error?: string;
  /** i18n key into the side panel's `error.*` namespace (preferred). */
  errorKey?: string;
}

/** Union of all messages the background may post back on the embedding port. */
export type EmbeddingResponse = EmbeddingMessage | EmbeddingErrorMessage;

// ---------------------------------------------------------------------------
// annotation port — content script ↔ background
// ---------------------------------------------------------------------------

export interface AnnotationRequest {
  type: 'annotate';
  fullArticle: string;
  chunkIndex: number;
  chunkText: string;
}

// ---------------------------------------------------------------------------
// One-shot chrome.runtime.sendMessage actions (not ports)
// ---------------------------------------------------------------------------

export interface SelectionChangedMessage {
  action: 'selectionChanged';
  text?: string;
  tabId?: number;
  forwarded?: boolean;
}

export interface FetchModelsMessage {
  action: 'fetchModels';
  apiBase?: string;
  apiKey?: string;
}

export interface FetchModelsResponse {
  success: boolean;
  models?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// pageRecords:* one-shot messages — related-pages store/find (handled by
// sw-related-pages.ts; records live in IndexedDB, see shared/page-records-db.ts)
// ---------------------------------------------------------------------------

export interface PageRecordsStoreMessage {
  action: 'pageRecords:store';
  record: Omit<PageRecord, 'id' | 'timestamp'>;
  maxPages: number;
}

export interface PageRecordsFindRelatedMessage {
  action: 'pageRecords:findRelated';
  normalizedUrl: string;
  threshold: number;
  limit: number;
}

export interface PageRecordsStoreResponse {
  success: boolean;
  error?: string;
}

export interface PageRecordsFindRelatedResponse {
  success: boolean;
  relations?: PageRelation[];
  error?: string;
}
