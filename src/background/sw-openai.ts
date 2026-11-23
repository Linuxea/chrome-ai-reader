import { streamToPort, type Purpose } from './chat-runner';
import { streamAgentToPort } from './agent-runner';
import type { ToolSpec } from './providers/types';
import type { ChatMessage } from '../shared/types';


interface StreamOptions {
  response_format?: Record<string, unknown>;
  temperature?: number;
  /** 'agent' runs the AI SDK tool loop (agent-runner.ts); 'chat' is a plain completion. */
  purpose?: Purpose;
  tools?: ToolSpec[];
  /** F15: declare DeepSeek's web search tool for this chat (the panel's `webSearch` setting). */
  webSearch?: boolean;
}

/**
 * Chat port (and podcast script): stream an answer, reasoning included.
 * Provider, model routing, timeouts and usage live in chat-runner.ts; the
 * agent tool loop lives in agent-runner.ts (Vercel AI SDK). Web search
 * (F15) is a plain-chat feature: the panel never asks for both it and the
 * agent tools on one request.
 */
export async function callOpenAI(messages: ChatMessage[], port: chrome.runtime.Port, options?: StreamOptions): Promise<void> {
  if (options?.purpose === 'agent') {
    await streamAgentToPort(port, { messages, tools: options.tools ?? [], temperature: options.temperature });
    return;
  }
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

