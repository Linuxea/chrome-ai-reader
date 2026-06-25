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

/**
 * A single chat message in the OpenAI-compatible chat-completion format.
 *
 * NOTE: the optional agent fields below (`tool_calls`, `tool_call_id`, `name`)
 * are RESERVED for a future agent/tool-calling architecture. They are not yet
 * populated by the current chatbot flow (which is pure text-in/text-out), but
 * declaring them here means the type contract is ready when tool calling is
 * introduced — callers won't need to widen ChatMessage later.
 */
/**
 * 一个多模态内容块。视觉消息的 `content` 是此类型的数组；
 * 纯文字消息的 `content` 仍是 `string`。遵循 OpenAI 兼容格式。
 */
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * 纯文字消息为 `string`；视觉/多模态消息为 `MessageContentPart[]`
   *（OpenAI 兼容格式：text 块 + image_url 块）。
   */
  content: string | MessageContentPart[];
  type?: string;
  /**
   * 仅内存态标记：该消息原本含图片，重启后图片已失效。
   * 持久化时仍保留此字段，用于重载后渲染"图片已失效"提示。
   */
  hadImages?: boolean;
  /** Tool calls emitted by the assistant (agent evolution — not yet wired). */
  tool_calls?: ToolCall[];
  /** When role is 'tool', the id of the tool call this result responds to. */
  tool_call_id?: string;
  /** Optional function/tool name (used with role 'tool' or 'assistant' tool_calls). */
  name?: string;
}

/**
 * A tool/function call the model requests the host to execute.
 * Reserved for agent evolution — the current chatbot never produces these.
 */
export interface ToolCall {
  /** Unique id for this call (model-provided). */
  id: string;
  /** The callable name (must match a registered tool). */
  name: string;
  /** JSON-encoded arguments string (per OpenAI convention). */
  arguments: string;
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
  ocrRunning: number;
  ocrResults: OcrResult[];
  imageIndex: number;
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
  /** Original URL as captured from the tab. */
  url: string;
  /**
   * Normalized URL used for matching/dedup. Computed via `normalizeUrl()`
   * (see `shared/url-normalize.ts`): hash stripped, tracking params removed,
   * remaining params sorted, host lowercased. Stored so queries don't have
   * to re-normalize on every read.
   */
  normalizedUrl: string;
  title: string;
  excerpt: string;
  embedding: number[];
  timestamp: number;
}

export interface PageRelation {
  record: PageRecord;
  similarity: number;
}

/**
 * Deep annotation (深度批阅) — AI-generated deep-perspective annotations
 * attached to sentences in the page. See
 * docs/superpowers/specs/2026-06-20-deep-annotation-design.md
 */

/** Three deep-perspective categories. */
export type AnnotationPerspective = 'critique' | 'counterpoint' | 'flaw';
//                         批判质疑       反方观点        逻辑漏洞

/** A single annotation on a quoted sentence. */
export interface Annotation {
  /** Generated client-side via crypto.randomUUID(). */
  id: string;
  perspective: AnnotationPerspective;
  /** Original-sentence quote returned by the model; used for DOM matching. */
  quote: string;
  /** Annotation body, 1-2 sentences. */
  comment: string;
}

/** Result of annotating one chunk. `annotations` may be empty (no worthy points). */
export interface AnnotationResult {
  chunkIndex: number;
  annotations: Annotation[];
}
