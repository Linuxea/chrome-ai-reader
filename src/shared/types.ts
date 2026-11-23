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
 * The optional agent fields below (`tool_calls`, `tool_call_id`, `name`,
 * `providerContent`, `agentTrace`) are populated by agent mode (F11): the
 * worker's tool loop round-trips `tool_calls` / `role: 'tool'` messages,
 * and the panel records the executed tools as `agentTrace`.
 */
/**
 * 一个多模态内容块。视觉消息的 `content` 是此类型的数组；
 * 纯文字消息的 `content` 仍是 `string`。遵循 OpenAI 兼容格式。
 */
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  /**
   * Stable local id (panel-generated UUID). Retry / edit address a history
   * entry by it — content matching picked the wrong turn when two user
   * messages had the same text. Absent only on legacy persisted messages,
   * which get one on restore (ensureMessageIds). Never sent to the API.
   */
  id?: string;
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
  /**
   * User messages only: what the user actually entered, kept next to the
   * assembled API `content` (which folds in the quote prefix / prompt). Lets
   * history re-renders show the original bubble and retry / edit it. Never
   * sent to the API (see toApiMessage).
   */
  meta?: UserMessageMeta;
  /** Tool calls the model emitted (agent mode F11; normalized to OpenAI style). */
  tool_calls?: ToolCall[];
  /** When role is 'tool', the id of the tool call this result responds to. */
  tool_call_id?: string;
  /** Optional function/tool name (used with role 'tool' or 'assistant' tool_calls). */
  name?: string;
  /**
   * Agent loop only: the provider's native assistant content for this turn
   * (e.g. Anthropic thinking + tool_use blocks), replayed verbatim to the same
   * provider on the next request. Never persisted, never shown.
   */
  providerContent?: unknown;
  /**
   * Assistant messages only (agent mode, F11): the tools this answer used,
   * recorded live and persisted with the chat so a reload can show the
   * collapsed "verification steps" block. Never sent to the API
   * (toApiMessage copies only the wire fields).
   */
  agentTrace?: AgentTraceStep[];
  /**
   * Assistant messages only (F15 web search): the server-side searches this
   * answer used, the sources it cites and where. Recorded when the stream
   * ends and persisted with the chat so a reload can rebuild the trace line
   * and the citation chips. Never sent to the API (toApiMessage copies only
   * the wire fields).
   */
  web?: WebResult;
  /**
   * Assistant messages only: how the answer ended + token usage — drives
   * the usage footer and the truncation / step-limit notes. Local-only,
   * stripped by toApiMessage; duplicated literals (not imported from
   * protocol.ts) to keep types.ts a leaf.
   */
  finish?: {
    reason?: 'stop' | 'length' | 'tool_calls' | 'refusal' | 'other';
    /** 'steps' qualifies reason 'length' as the agent round cap. */
    limit?: 'steps';
    usage?: { inputTokens: number; outputTokens: number };
    model?: string;
  };
}

// --- F15 web search (DeepSeek's server-side `deepseek_web_search` tool) -------

/** A web page the answer drew on. */
export interface WebSource {
  url: string;
  /** Page title; falls back to the URL when the API gave none. */
  title: string;
  siteName?: string;
}

/** What one server-side call did. */
export type WebStepAction =
  | { type: 'search'; queries: string[] }
  | { type: 'open_page'; url: string }
  | { type: 'find_in_page'; url: string; pattern: string };

/**
 * One server-side tool call. The search runs on DeepSeek's side — the
 * extension only displays these.
 */
export interface WebStep {
  /** The call's id on the wire (`srvtoolu_…`); completion events are matched by it (they arrive out of order). */
  id: string;
  /** `deep_search` / `deep_image_search` when the model thinks between calls. */
  kind: 'search' | 'deep_search' | 'image_search' | 'deep_image_search';
  action: WebStepAction;
  status: 'completed' | 'failed';
  /** Search calls: the results this call returned. */
  sources?: WebSource[];
  /** open_page / find_in_page: the page that was opened. */
  page?: { url: string; title: string | null };
  /** Error code of a failed call (e.g. `url_not_accessible`). */
  error?: string;
}

/**
 * A citation into the answer. `start` / `end` are Unicode CODE POINT offsets
 * into the answer's Markdown (that is how the API counts), `source` indexes
 * `WebResult.sources`.
 */
export interface WebCitation {
  start: number;
  end: number;
  source: number;
}

/** Everything an answer's web search produced, for display only. */
export interface WebResult {
  /** Calls in execution order. */
  steps: WebStep[];
  /** Cited sources, de-duplicated by URL in first-cited order. */
  sources: WebSource[];
  citations: WebCitation[];
  /** Number of search calls (NOT `usage.server_tool_use.tool_search`, which counts queries). */
  searches: number;
  /** Number of distinct pages opened. */
  pages: number;
}

/** One tool execution recorded for an answer's agent trace. */
export interface AgentTraceStep {
  /** Tool name as the model called it (e.g. 'search_page'). */
  name: string;
  /** Human-readable argument summary (describeArgs), shown in the step list. */
  args: string;
  /** Excerpt of the tool result — shown when the step is expanded. */
  result: string;
  /** 1-based loop round the call belonged to. */
  round: number;
}

export interface UserMessageMeta {
  /** Text handed to sendToAI (a quick action's prompt, or the typed text). */
  rawText: string;
  /** Text shown in the bubble (e.g. the quick action's label). */
  displayText: string;
  /** Full quoted page text, when the message carried a quote. */
  quote?: string;
  /** Other tabs attached as context (F4); re-read on retry. */
  tabs?: { id: number; title: string; url: string }[];
}

/**
 * A tool/function call the model requests the host to execute (agent mode F11).
 */
export interface ToolCall {
  /** Unique id for this call (model-provided). */
  id: string;
  /** The callable name (must match a registered tool). */
  name: string;
  /** JSON-encoded arguments string (per OpenAI convention). */
  arguments: string;
}

export interface BranchSet {
  tails: (ChatMessage[] | null)[];
  active: number;
}

import type { QuizSession } from './quiz';

export interface TabState {
  pageContent: string;
  pageTitle: string;
  pageExcerpt: string;
  /** URL the cached page content was extracted from (hash stripped). */
  pageUrl?: string;
  /** The article split into paragraphs ([#N] in prompts, citation targets). */
  pageParagraphs?: string[];
  /** F12: the interactive quiz session for this tab (survives tab switches). */
  quizSession?: QuizSession;
  /**
   * F10 branches: alternative continuations after a message (key: the id of
   * the message before the fork, or ROOT_BRANCH). `tails[active]` is null —
   * that continuation is the live one in conversationHistory.
   */
  branches?: Record<string, BranchSet>;
  conversationHistory: ChatMessage[];
  currentChatId: string | null;
  selectedText: string;
  isGenerating: boolean;
  isPodcastGenerating: boolean;
  imageIndex: number;
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

/**
 * Deep annotation (深度批阅) — AI-generated deep-perspective annotations
 * attached to sentences in the page.
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
