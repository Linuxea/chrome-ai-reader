import { safePostMessage } from './sw-utils';

interface ChatMessage { role: string; content: string | unknown[]; [key: string]: unknown; }

interface ChatProviderConfig {
  apiKey: string;
  apiBase: string;
  modelName: string;
}

interface StreamOptions {
  response_format?: Record<string, unknown>;
  temperature?: number;
}

interface DeltaHandlers {
  onContent: (content: string) => void;
  onThinking?: (content: string) => void;
}

const DEFAULT_API_BASE = 'https://api.deepseek.com';

async function loadChatConfig(): Promise<{ apiKey?: string; apiBase?: string; modelName?: string }> {
  return await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']) as { apiKey?: string; apiBase?: string; modelName?: string };
}

/**
 * Single SSE streaming pipeline for every chat-completions caller
 * (ai-chat, suggest-questions, podcast-llm). Previously each caller carried
 * its own copy of the reader/decoder/line-split loop, which let the wire
 * handling drift and scattered the delta-parsing point.
 *
 * AGENT TODO: when tool calling is introduced, this delta parse is the ONE
 * place to extend — read delta.tool_calls alongside reasoning_content/content
 * and forward them via a new handler + StreamMessage variant (see
 * shared/protocol.ts).
 */
async function streamChatCompletion(
  config: ChatProviderConfig,
  messages: ChatMessage[],
  port: chrome.runtime.Port,
  options: StreamOptions,
  handlers: DeltaHandlers,
): Promise<void> {
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  try {
    // Temperature defaults to 0.7 (conversational). Callers doing structured
    // JSON work (e.g. outline) pass a lower value for format stability.
    const requestBody: Record<string, unknown> = { model: config.modelName, messages, stream: true, temperature: options.temperature ?? 0.7 };
    if (options.response_format) requestBody.response_format = options.response_format;

    const response = await fetch(`${config.apiBase}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify(requestBody), signal: controller.signal,
    });

    if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error((errorData as Record<string, { message?: string }>).error?.message || `API request failed (${response.status})`); }

    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') { safePostMessage(port, { type: 'done' }); return; }
        try {
          const parsed = JSON.parse(data) as { choices?: { delta?: { reasoning_content?: string; content?: string } }[] }; const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) handlers.onThinking?.(delta.reasoning_content);
          if (delta?.content) handlers.onContent(delta.content);
        } catch { /* skip */ }
      }
    }
    safePostMessage(port, { type: 'done' });
  } catch (e: unknown) { safePostMessage(port, { type: 'error', error: (e as Error).message }); }
}

export async function callOpenAI(messages: ChatMessage[], port: chrome.runtime.Port, options?: StreamOptions): Promise<void> {
  const { apiKey, apiBase, modelName } = await loadChatConfig();
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKey' }); return; }
  if (!modelName) { safePostMessage(port, { type: 'error', errorKey: 'error.noModelName' }); return; }

  await streamChatCompletion(
    { apiKey, apiBase: apiBase || DEFAULT_API_BASE, modelName },
    messages,
    port,
    options ?? {},
    {
      onThinking: (content) => safePostMessage(port, { type: 'thinking', content }),
      onContent: (content) => safePostMessage(port, { type: 'chunk', content }),
    },
  );
}

export async function callSuggestQuestions(messages: ChatMessage[], port: chrome.runtime.Port): Promise<void> {
  const { apiKey, apiBase, modelName } = await loadChatConfig();
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKeySuggest' }); return; }
  if (!modelName) { safePostMessage(port, { type: 'error', errorKey: 'error.noModelName' }); return; }

  await streamChatCompletion(
    { apiKey, apiBase: apiBase || DEFAULT_API_BASE, modelName },
    messages,
    port,
    { temperature: 0.8 },
    { onContent: (content) => safePostMessage(port, { type: 'chunk', content }) },
  );
}

export async function callEmbedding(text: string, port: chrome.runtime.Port): Promise<void> {
  // Embedding must be configured independently — there is no fallback to the
  // chat apiKey/apiBase. The default `doubao-embedding-vision` model and the
  // hardcoded volcano-engine base URL previously caused silent 401/404 when
  // users only configured a chat provider (e.g. DeepSeek). Now any missing
  // field surfaces as an explicit error the UI can show.
  const { embeddingApiKey, embeddingApiBase, embeddingModel } = await chrome.storage.sync.get([
    'embeddingApiKey', 'embeddingApiBase', 'embeddingModel',
  ]) as { embeddingApiKey?: string; embeddingApiBase?: string; embeddingModel?: string };

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
