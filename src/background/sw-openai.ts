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

/** An embedding failure the UI can explain (errorKey) or show verbatim (message). */
export class EmbeddingError extends Error {
  constructor(message: string, readonly errorKey?: string) { super(message); }
}

/**
 * Embed one text with the independently configured embedding provider.
 * There is no fallback to the chat provider: a DeepSeek-only setup used to
 * hit a hard-coded Volcengine default and fail with a silent 401/404.
 */
export async function embedText(text: string, signal?: AbortSignal): Promise<number[]> {
  const { embeddingApiKey, embeddingApiBase, embeddingModel } = await readSettings([
    'embeddingApiKey', 'embeddingApiBase', 'embeddingModel',
  ]);
  if (!embeddingApiKey || !embeddingApiBase || !embeddingModel) {
    throw new EmbeddingError('embedding not configured', 'error.embeddingNotConfigured');
  }
  const response = await fetch(`${embeddingApiBase}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${embeddingApiKey}` },
    body: JSON.stringify({ model: embeddingModel, input: text }),
    signal,
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new EmbeddingError(
      (errorData as Record<string, { message?: string }>).error?.message || `Embedding API request failed (${response.status})`,
      'error.embeddingRequestFailed',
    );
  }
  const data = await response.json() as { data?: { embedding: number[] }[] };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) throw new EmbeddingError('empty embedding', 'error.emptyEmbedding');
  return embedding;
}

export async function callEmbedding(text: string, port: chrome.runtime.Port): Promise<void> {
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  try {
    safePostMessage(port, { type: 'embedding', embedding: await embedText(text, controller.signal) });
  } catch (e: unknown) {
    const err = e as EmbeddingError;
    // Config problems carry only a key; request failures also carry the detail.
    if (err.errorKey && err.errorKey !== 'error.embeddingRequestFailed') safePostMessage(port, { type: 'error', errorKey: err.errorKey });
    else safePostMessage(port, { type: 'error', error: err.message, errorKey: 'error.embeddingRequestFailed' });
  }
}
