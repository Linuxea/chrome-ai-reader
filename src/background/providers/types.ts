/**
 * Provider-neutral chat streaming contract. Each provider turns its wire
 * format into this one delta stream; background/chat-runner.ts consumes it.
 */

import type { ChatMessage, ToolCall } from '../../shared/types';
import type { FinishReason, TokenUsage } from '../../shared/protocol';

export type ChatDelta =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  /** A complete tool call (arguments fully streamed). */
  | { type: 'tool_call'; call: ToolCall }
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
