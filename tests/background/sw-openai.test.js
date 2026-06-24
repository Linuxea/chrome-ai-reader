import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock chrome.storage.sync.get — sw-openai uses await-style
const store = { sync: { apiKey: 'sk-test', apiBase: 'https://api.test.com', modelName: 'test-model' } };

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store.sync[k] !== undefined) result[k] = store.sync[k]; });
        return Promise.resolve(result);
      },
    },
  },
});

// Mock sw-utils
vi.mock('../../src/background/sw-utils.js', () => ({
  safePostMessage: vi.fn(),
}));

import { callOpenAI, callSuggestQuestions, callEmbedding } from '../../src/background/sw-openai.js';
import { safePostMessage } from '../../src/background/sw-utils.js';

function createMockPort() {
  const disconnectListeners = new Set();
  return {
    postMessage: vi.fn(),
    onDisconnect: {
      addListener: vi.fn(fn => disconnectListeners.add(fn)),
      removeListener: vi.fn(),
    },
    _simulateDisconnect() { disconnectListeners.forEach(fn => fn()); },
  };
}

function createSSEStream(chunks) {
  const lines = chunks.map(c => `data: ${JSON.stringify(c)}`).join('\n') + '\ndata: [DONE]\n';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(lines);
  return {
    getReader() {
      let i = 0;
      return {
        read() {
          if (i >= bytes.length) return Promise.resolve({ done: true });
          const chunk = bytes.slice(i, i + 100);
          i += 100;
          return Promise.resolve({ done: false, value: chunk });
        },
      };
    },
  };
}

describe('background/sw-openai', () => {
  let port;

  beforeEach(() => {
    vi.clearAllMocks();
    port = createMockPort();
    store.sync.apiKey = 'sk-test';
    store.sync.apiBase = 'https://api.test.com';
    store.sync.modelName = 'test-model';
  });

  describe('callOpenAI', () => {
    it('sends error when no API key', async () => {
      store.sync.apiKey = undefined;
      await callOpenAI([], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.noApiKey' });
    });

    it('makes fetch request and streams chunks', async () => {
      const sseBody = createSSEStream([
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
      ]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: sseBody,
        json: vi.fn(),
      });

      await callOpenAI([{ role: 'user', content: 'hi' }], port);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        })
      );

      // Should have received chunks + done
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'chunk', content: 'Hello' });
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'chunk', content: ' world' });
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'done' });
    });

    it('streams reasoning_content as thinking type', async () => {
      const sseBody = createSSEStream([
        { choices: [{ delta: { reasoning_content: 'thinking...' } }] },
      ]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: sseBody,
        json: vi.fn(),
      });

      await callOpenAI([{ role: 'user', content: 'think' }], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'thinking', content: 'thinking...' });
    });

    it('sends error on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({ error: { message: 'rate limited' } }),
      });

      await callOpenAI([{ role: 'user', content: 'hi' }], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: 'rate limited',
      });
    });

    it('sends error with status when no error message in response body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      await callOpenAI([{ role: 'user', content: 'hi' }], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: 'API request failed (500)',
      });
    });

    it('uses default apiBase when not configured', async () => {
      store.sync.apiBase = undefined;
      const sseBody = createSSEStream([]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: sseBody,
        json: vi.fn(),
      });

      await callOpenAI([{ role: 'user', content: 'hi' }], port);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/chat/completions',
        expect.anything()
      );
    });

    it('includes response_format in request body when provided', async () => {
      const sseBody = createSSEStream([]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: sseBody,
        json: vi.fn(),
      });

      await callOpenAI([{ role: 'user', content: 'hi' }], port, {
        response_format: { type: 'json_object' },
      });

      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('posts error when modelName is not configured (no default fallback)', async () => {
      store.sync.modelName = undefined;
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await callOpenAI([{ role: 'user', content: 'hi' }], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.noModelName' });
      expect(fetchSpy).not.toHaveBeenCalled();
      store.sync.modelName = 'test-model';
    });

    it('sends error on fetch exception', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

      await callOpenAI([{ role: 'user', content: 'hi' }], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: 'network error',
      });
    });

    it('sends done at end of stream without [DONE] marker', async () => {
      // Stream that ends without [DONE]
      const encoder = new TextEncoder();
      const lines = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
      const bytes = encoder.encode(lines);
      const body = {
        getReader() {
          let i = 0;
          return {
            read() {
              if (i >= bytes.length) return Promise.resolve({ done: true });
              const chunk = bytes.slice(i);
              i = bytes.length;
              return Promise.resolve({ done: false, value: chunk });
            },
          };
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
        json: vi.fn(),
      });

      await callOpenAI([{ role: 'user', content: 'hi' }], port);
      // Should still send 'done' at end of while loop
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'done' });
    });
  });

  describe('callSuggestQuestions', () => {
    it('sends error when no API key', async () => {
      store.sync.apiKey = undefined;
      await callSuggestQuestions([], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.noApiKeySuggest' });
    });

    it('makes fetch request and streams content chunks', async () => {
      const sseBody = createSSEStream([
        { choices: [{ delta: { content: 'Q1?' } }] },
        { choices: [{ delta: { content: ' Q2?' } }] },
      ]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: sseBody,
        json: vi.fn(),
      });

      await callSuggestQuestions([{ role: 'user', content: 'suggest' }], port);

      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'chunk', content: 'Q1?' });
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'chunk', content: ' Q2?' });
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'done' });
    });

    it('does not forward reasoning_content in suggest mode', async () => {
      const sseBody = createSSEStream([
        { choices: [{ delta: { reasoning_content: 'thinking' } }] },
        { choices: [{ delta: { content: 'result' } }] },
      ]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: sseBody,
        json: vi.fn(),
      });

      await callSuggestQuestions([{ role: 'user', content: 'suggest' }], port);

      // Only chunk + done, no thinking message
      const calls = safePostMessage.mock.calls.filter(c => c[1].type === 'thinking');
      expect(calls.length).toBe(0);
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'chunk', content: 'result' });
    });

    it('sends error on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

      await callSuggestQuestions([{ role: 'user', content: 'suggest' }], port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: 'timeout',
      });
    });

    it('uses temperature 0.8', async () => {
      const sseBody = createSSEStream([]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: sseBody,
        json: vi.fn(),
      });

      await callSuggestQuestions([{ role: 'user', content: 'suggest' }], port);
      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.temperature).toBe(0.8);
    });
  });

  describe('callEmbedding', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      port = createMockPort();
      // Embedding must now be configured INDEPENDENTLY — there is no fallback
      // to apiKey/apiBase. Tests that want a fully-configured state must set
      // all three embedding_* fields explicitly.
      store.sync = {
        apiKey: 'sk-chat-only',
        apiBase: 'https://chat-only.example.com',
        embeddingApiKey: 'sk-emb',
        embeddingApiBase: 'https://emb.example.com/v1',
        embeddingModel: 'text-embedding-3-small',
      };
    });

    it('sends embedding request and returns vector with independent config', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
        })
      );

      await callEmbedding('test text', port);

      // Must hit the embedding endpoint (not the chat apiBase), with the
      // embedding key (not the chat key), and the embedding model.
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://emb.example.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer sk-emb' }),
          body: expect.stringContaining('text-embedding-3-small'),
        })
      );
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'embedding', embedding: mockEmbedding });
    });

    it('returns error.embeddingNotConfigured when embeddingApiKey is missing', async () => {
      delete store.sync.embeddingApiKey;
      globalThis.fetch = vi.fn();

      await callEmbedding('test', port);

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.embeddingNotConfigured' });
    });

    it('returns error.embeddingNotConfigured when embeddingApiBase is missing', async () => {
      delete store.sync.embeddingApiBase;
      globalThis.fetch = vi.fn();

      await callEmbedding('test', port);

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.embeddingNotConfigured' });
    });

    it('returns error.embeddingNotConfigured when embeddingModel is missing', async () => {
      delete store.sync.embeddingModel;
      globalThis.fetch = vi.fn();

      await callEmbedding('test', port);

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.embeddingNotConfigured' });
    });

    it('does NOT fall back to chat apiKey/apiBase when embedding fields are missing', async () => {
      // Strip embedding config entirely — chat config must not be used.
      store.sync = { apiKey: 'sk-chat-only', apiBase: 'https://chat-only.example.com' };
      globalThis.fetch = vi.fn();

      await callEmbedding('test', port);

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.embeddingNotConfigured' });
    });

    it('sends error on API failure', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
        })
      );

      await callEmbedding('test', port);
      // The wrapper forwards the API error message and an errorKey hint.
      expect(safePostMessage).toHaveBeenCalledWith(
        port,
        expect.objectContaining({ type: 'error', error: 'Unauthorized' })
      );
    });

    it('sends error on empty embedding', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ embedding: [] }] }),
        })
      );

      await callEmbedding('test', port);
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.emptyEmbedding' });
    });
  });
});
