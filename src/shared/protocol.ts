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

import type { ChatMessage, ToolCall } from './types';

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
  ANNOTATION: 'annotation',
  /** F7 immersive translation (content script ↔ worker). */
  TRANSLATE: 'translate',
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
  temperature?: number;
  /**
   * What the request is for. Routes 'light' work (titles, quizzes, …) to the
   * optional fast model; 'agent' enables tool calling with the panel's tools.
   */
  purpose?: 'chat' | 'light' | 'agent';
  /** Agent mode: tool definitions the panel can execute. */
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
}

/** Why generation ended, normalized across providers. */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'refusal' | 'other';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Streaming messages posted FROM the background on the ai-chat (and any
 *  text-streaming) port. Same shape is reused by suggest-questions & podcast-llm. */
export type StreamMessage =
  | { type: 'thinking'; content: string }
  | { type: 'chunk'; content: string }
  /**
   * `finishReason: 'length'` = the answer was cut off by the output limit;
   * `limit: 'steps'` qualifies it as the agent tool-round limit (not tokens)
   * so the panel can word the note correctly.
   */
  | { type: 'done'; finishReason?: FinishReason; usage?: TokenUsage; model?: string; limit?: 'steps' }
  | { type: 'error'; error?: string; errorKey?: string }
  /**
   * Agent mode: the model asked for tools. The panel runs them and answers
   * on the same port with a ToolResultsMessage; the worker then continues.
   */
  | { type: 'tool_calls'; calls: ToolCall[] };

/** Panel → worker on the ai-chat port, answering a `tool_calls` message. */
export interface ToolResultsMessage {
  type: 'tool_results';
  results: { tool_call_id: string; name: string; content: string }[];
}

// ---------------------------------------------------------------------------
// suggest-questions port
// ---------------------------------------------------------------------------

export interface SuggestRequest {
  type: 'suggest';
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// tts / tts-download ports
//
// The SW translates the upstream Volcengine SSE events (352 audio chunk /
// 152 session finish / 153 failure — see background/sw-tts.ts) into these
// simple wire messages; one port per synthesized segment.
// ---------------------------------------------------------------------------

export interface TTSRequest {
  type: 'tts';
  text: string;
}

export type TTSMessage =
  | { type: 'chunk'; data: string } // base64 mp3 bytes
  | { type: 'done' } // segment synthesis finished
  | { type: 'error'; error?: string; errorKey?: string };

// ---------------------------------------------------------------------------
// podcast-llm port — JSON-mode script + title/description generation
// ---------------------------------------------------------------------------

export interface PodcastLLMRequest {
  type: 'generate';
  prompt: string;
  text: string;
  /** Image data URIs (vision mode) — sent to the model as image_url parts. */
  images?: string[];
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
  provider?: 'openai' | 'anthropic';
}

export interface FetchModelsResponse {
  success: boolean;
  models?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// scrollPage* one-shot chrome.tabs.sendMessage actions — full-page capture
// scroll control (content/scroll-controller.ts ↔ services/screenshot.ts)
// ---------------------------------------------------------------------------

/** Metrics reported back by the content script after each programmatic scroll. */
export interface ScrollPageState {
  /** Current scroll offset of the page's scrolling element. */
  y: number;
  /** Visible viewport height (px). */
  innerHeight: number;
  /** Total page height (px) — may grow between calls as lazy content loads. */
  scrollHeight: number;
  /** True when one more viewport-height scroll can no longer advance. */
  atBottom: boolean;
}
