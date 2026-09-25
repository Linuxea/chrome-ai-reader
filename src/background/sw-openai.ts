import { safePostMessage } from './sw-utils';
import { readSettings } from '../platform/settings';
import { streamToPort, type Purpose } from './chat-runner';
import type { ToolSpec } from './providers/types';
import type { ChatMessage } from '../shared/types';


interface StreamOptions {
  response_format?: Record<string, unknown>;
  temperature?: number;
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
    purpose: options?.purpose ?? 'chat',
    temperature: options?.temperature,
    jsonMode: options?.response_format?.type === 'json_object',
    tools: options?.tools,
    emitThinking: true,
  });
}

/** Suggested follow-up questions: light work (fast model if set), no reasoning forwarded. */
export async function callSuggestQuestions(messages: ChatMessage[], port: chrome.runtime.Port): Promise<void> {
  await streamToPort(port, {
    messages,
    purpose: 'light',
    temperature: 0.8,
    emitThinking: false,
    noKeyErrorKey: 'error.noApiKeySuggest',
  });
}

export async function callEmbedding(text: string, port: chrome.runtime.Port): Promise<void> {
  // Embedding must be configured independently — there is no fallback to the
  // chat apiKey/apiBase. The default `doubao-embedding-vision` model and the
  // hardcoded volcano-engine base URL previously caused silent 401/404 when
  // users only configured a chat provider (e.g. DeepSeek). Now any missing
  // field surfaces as an explicit error the UI can show.
  const { embeddingApiKey, embeddingApiBase, embeddingModel } = await readSettings([
    'embeddingApiKey', 'embeddingApiBase', 'embeddingModel',
  ]);

  if (!embeddingApiKey || !embeddingApiBase || !embeddingModel) {
    safePostMessage(port, { type: 'error', errorKey: 'error.embeddingNotConfigured' });
    return;
  }

  const baseUrl = embeddingApiBase;
  const model = embeddingModel;

  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${embeddingApiKey}` },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error((errorData as Record<string, { message?: string }>).error?.message || `Embedding API request failed (${response.status})`);
    }

    const data = await response.json() as { data?: { embedding: number[] }[] };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      safePostMessage(port, { type: 'error', errorKey: 'error.emptyEmbedding' });
      return;
    }
    safePostMessage(port, { type: 'embedding', embedding });
  } catch (e: unknown) {
    safePostMessage(port, { type: 'error', error: (e as Error).message, errorKey: 'error.embeddingRequestFailed' });
  }
}
