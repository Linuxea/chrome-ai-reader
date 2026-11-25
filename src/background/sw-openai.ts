import { streamToPort } from './chat-runner';
import type { ChatMessage } from '../shared/types';


interface StreamOptions {
  response_format?: Record<string, unknown>;
  temperature?: number;
  /** F15: declare DeepSeek's web search tool for this chat (the panel's `webSearch` setting). */
  webSearch?: boolean;
}

/**
 * Chat port (and podcast script): stream an answer, reasoning included.
 * Provider, model routing, timeouts, usage and web search live in
 * chat-runner.ts.
 */
export async function callOpenAI(messages: ChatMessage[], port: chrome.runtime.Port, options?: StreamOptions): Promise<void> {
  await streamToPort(port, {
    messages,
    temperature: options?.temperature,
    jsonMode: options?.response_format?.type === 'json_object',
    emitThinking: true,
    webSearch: options?.webSearch,
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

