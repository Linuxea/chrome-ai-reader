import { safePostMessage } from './sw-utils';

interface ChatMessage { role: string; content: string; [key: string]: unknown; }

export async function callOpenAI(messages: ChatMessage[], port: chrome.runtime.Port, options?: { response_format?: Record<string, unknown> }): Promise<void> {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']) as { apiKey?: string; apiBase?: string; modelName?: string };
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKey' }); return; }

  const baseUrl = apiBase || 'https://api.deepseek.com';
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  try {
    // AGENT TODO: when tool calling is introduced, accept an optional `tools`
    // array here and add it to requestBody. The SSE parser below must then
    // also read delta.tool_calls (currently only reasoning_content + content).
    const requestBody: Record<string, unknown> = { model: modelName || 'deepseek-chat', messages, stream: true, temperature: 0.7 };
    if (options?.response_format) requestBody.response_format = options.response_format;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody), signal: controller.signal,
    });

    if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error((errorData as Record<string, unknown>).error && typeof (errorData as Record<string, unknown>).error === 'object' ? ((errorData as Record<string, { message?: string }>).error?.message) : `API request failed (${response.status})`); }

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
          // AGENT TODO: extend this delta type with `tool_calls?: ToolCallDelta[]`
          // and forward them as a new StreamMessage variant (see shared/protocol.ts).
          // Currently only reasoning_content + content are read; tool_calls would
          // be silently dropped.
          const parsed = JSON.parse(data) as { choices?: { delta?: { reasoning_content?: string; content?: string } }[] }; const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) safePostMessage(port, { type: 'thinking', content: delta.reasoning_content });
          if (delta?.content) safePostMessage(port, { type: 'chunk', content: delta.content });
        } catch { /* skip */ }
      }
    }
    safePostMessage(port, { type: 'done' });
  } catch (e: unknown) { safePostMessage(port, { type: 'error', error: (e as Error).message }); }
}

export async function callSuggestQuestions(messages: ChatMessage[], port: chrome.runtime.Port): Promise<void> {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']) as { apiKey?: string; apiBase?: string; modelName?: string };
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKeySuggest' }); return; }

  const baseUrl = apiBase || 'https://api.deepseek.com';
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelName || 'deepseek-chat', messages, stream: true, temperature: 0.8 }), signal: controller.signal,
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
        try { const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }; const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) safePostMessage(port, { type: 'chunk', content: delta.content });
        } catch { /* skip */ }
      }
    }
    safePostMessage(port, { type: 'done' });
  } catch (e: unknown) { safePostMessage(port, { type: 'error', error: (e as Error).message }); }
}

export async function callEmbedding(text: string, port: chrome.runtime.Port): Promise<void> {
  const { embeddingApiKey, embeddingApiBase, embeddingModel, apiKey, apiBase } = await chrome.storage.sync.get([
    'embeddingApiKey', 'embeddingApiBase', 'embeddingModel', 'apiKey', 'apiBase',
  ]) as { embeddingApiKey?: string; embeddingApiBase?: string; embeddingModel?: string; apiKey?: string; apiBase?: string };

  const key = embeddingApiKey || apiKey;
  if (!key) { safePostMessage(port, { type: 'error', errorKey: 'error.noEmbeddingApiKey' }); return; }

  const baseUrl = embeddingApiBase || apiBase || 'https://ark.cn-beijing.volces.com/api/coding/v3';
  const model = embeddingModel || 'doubao-embedding-vision';

  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
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
    safePostMessage(port, { type: 'error', error: (e as Error).message });
  }
}
