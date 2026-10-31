import { streamToPort, type Purpose } from './chat-runner';
import type { ToolSpec } from './providers/types';
import type { ChatMessage } from '../shared/types';


interface StreamOptions {
  response_format?: Record<string, unknown>;
  temperature?: number;
  /** 'agent' forwards tool calling to the runner; 'chat' is a plain completion. */
  purpose?: Purpose;
  tools?: ToolSpec[];
}

/**
 * Chat port (and podcast script): stream an answer, reasoning included.
 * Provider, model routing, timeouts and usage live in chat-runner.ts.
 */
export async function callOpenAI(messages: ChatMessage[], port: chrome.runtime.Port, options?: StreamOptions): Promise<void> {
  await streamToPort(port, {
    messages,
    purpose: options?.purpose,
    temperature: options?.temperature,
    jsonMode: options?.response_format?.type === 'json_object',
    tools: options?.tools,
    emitThinking: true,
  });
}

/** Suggested follow-up questions: no reasoning forwarded. */
export async function callSuggestQuestions(messages: ChatMessage[], port: chrome.runtime.Port): Promise<void> {
  await streamToPort(port, {
    messages,
    temperature: 0.8,
    emitThinking: false,
    noKeyErrorKey: 'error.noApiKeySuggest',
  });
}

