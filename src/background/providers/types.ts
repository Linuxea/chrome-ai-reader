/**
 * Provider-neutral chat streaming contract. Each provider turns its wire
 * format into this one delta stream; background/chat-runner.ts consumes it.
 */

import type { ChatMessage, ToolCall, WebResult } from '../../shared/types';
import type { FinishReason, ServerToolEvent, TokenUsage } from '../../shared/protocol';

export type ChatDelta =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  /** A complete tool call (arguments fully streamed). */
  | { type: 'tool_call'; call: ToolCall }
  /**
   * F15 web search: one progress event of a server-side tool call. Yielded
   * for every event (including `step_reasoning_done`) so the runner's idle
   * watchdog sees the stream is alive while the model searches.
   */
  | { type: 'search_event'; event: ServerToolEvent }
  | {
    type: 'finish';
    reason: FinishReason;
    usage?: TokenUsage;
    /**
     * Provider-native assistant content to replay verbatim on the next
     * request of a tool loop (Anthropic requires its thinking blocks back
     * unchanged next to the tool_use blocks). Opaque to everyone else.
     */
    providerContent?: unknown;
    /** F15: present only when the answer used the web. */
    web?: WebResult;
  };

/** A tool the model may call (JSON Schema parameters). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** Ask for a JSON object answer (native mode where the provider has one). */
  jsonMode?: boolean;
  tools?: ToolSpec[];
  /**
   * F15: declare DeepSeek's server-side `deepseek_web_search` tool. The rule
   * (a system message) and the `latest_reminder` travel with the declaration
   * — the provider sends all three or none, so the model is never told it
   * can search on a request that does not offer the tool.
   */
  webSearch?: { rule: string; reminder: string };
}

export interface ProviderConfig {
  apiKey: string;
  apiBase: string;
}

export interface ChatProvider {
  stream(config: ProviderConfig, req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta>;
}

/** An API error with the HTTP status (when there was a response). */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}
