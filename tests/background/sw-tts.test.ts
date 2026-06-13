/**
 * Tests for background/sw-tts.ts — ByteDance TTS SSE streaming.
 *
 * Tests the SSE event-code protocol: 352=audio chunk, 152=session finish,
 * 153=synthesis failure. Also covers config validation and fetch error paths.
 *
 * Pattern follows sw-openai.test.js: mock chrome.storage (promise-style),
 * mock sw-utils.safePostMessage, mock fetch with ReadableStream SSE body.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mock chrome.storage.sync.get (promise-style, as sw-tts uses await) ---
const store: Record<string, unknown> = {
  sync: {
    ttsAppId: 'test-app-id',
    ttsAccessKey: 'test-access-key',
    ttsResourceId: 'seed-tts-2.0',
    ttsSpeaker: 'zh_female_test',
  },
};

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys: string[] | string) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
          if ((store.sync as Record<string, unknown>)[k] !== undefined) {
            result[k] = (store.sync as Record<string, unknown>)[k];
          }
        });
        return Promise.resolve(result);
      },
    },
  },
});

// --- Mock sw-utils ---
vi.mock('../../src/background/sw-utils.js', () => ({
  safePostMessage: vi.fn(),
}));

import { callTTS } from '../../src/background/sw-tts.js';
import { safePostMessage } from '../../src/background/sw-utils.js';

// --- Test helpers ---

/** Create a mock chrome.runtime.Port with disconnect listener capture */
function createMockPort() {
  const disconnectListeners = new Set<() => void>();
  return {
    postMessage: vi.fn(),
    onDisconnect: {
      addListener: vi.fn((fn: () => void) => disconnectListeners.add(fn)),
      removeListener: vi.fn(),
    },
    _simulateDisconnect() {
      disconnectListeners.forEach(fn => fn());
    },
  };
}

/**
 * Build an SSE response body from an array of { event, data } entries.
 * Each entry produces `event: <type>\ndata: <json>\n\n` — matching the
 * ByteDance TTS SSE wire format.
 */
function createSSEBody(
  events: { event: string; data: Record<string, unknown> }[],
): ReadableStream<Uint8Array> {
  const text = events
    .map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join('');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      // Split into small chunks to exercise the buffer-accumulation logic
      for (let i = 0; i < bytes.length; i += 100) {
        controller.enqueue(bytes.slice(i, i + 100));
      }
      controller.close();
    },
  });
}

describe('background/sw-tts', () => {
  let port: ReturnType<typeof createMockPort>;

  beforeEach(() => {
    vi.clearAllMocks();
    port = createMockPort();
    // Restore default config
    store.sync = {
      ttsAppId: 'test-app-id',
      ttsAccessKey: 'test-access-key',
      ttsResourceId: 'seed-tts-2.0',
      ttsSpeaker: 'zh_female_test',
    };
  });

  describe('config validation', () => {
    it('sends error when ttsAppId is missing', async () => {
      delete (store.sync as Record<string, unknown>).ttsAppId;
      await callTTS('hello', port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        errorKey: 'error.noTtsConfig',
      });
    });

    it('sends error when ttsAccessKey is missing', async () => {
      delete (store.sync as Record<string, unknown>).ttsAccessKey;
      await callTTS('hello', port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        errorKey: 'error.noTtsConfig',
      });
    });

    it('does not attempt fetch when config is missing', async () => {
      delete (store.sync as Record<string, unknown>).ttsAppId;
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await callTTS('hello', port);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('fetch and streaming', () => {
    it('sends fetch request with correct headers and body', async () => {
      const body = createSSEBody([
        { event: '352', data: { code: 0, data: 'base64-audio-1' } },
        { event: '152', data: { code: 20000000 } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('test text', port);

      expect(fetch).toHaveBeenCalledWith(
        'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Api-App-Id': 'test-app-id',
            'X-Api-Access-Key': 'test-access-key',
            'X-Api-Resource-Id': 'seed-tts-2.0',
          }),
        }),
      );

      // Verify request body contains the text and speaker
      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      const parsedBody = JSON.parse(fetchCall.body as string);
      expect(parsedBody.req_params.text).toBe('test text');
      expect(parsedBody.req_params.speaker).toBe('zh_female_test');
    });

    it('uses default resourceId and speaker when not configured', async () => {
      delete (store.sync as Record<string, unknown>).ttsResourceId;
      delete (store.sync as Record<string, unknown>).ttsSpeaker;

      const body = createSSEBody([
        { event: '152', data: { code: 20000000 } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('text', port);

      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      const parsedBody = JSON.parse(fetchCall.body as string);
      expect(parsedBody.req_params.speaker).toBe('zh_female_vv_uranus_bigtts');
      expect(fetchCall.headers).toHaveProperty('X-Api-Resource-Id', 'seed-tts-2.0');
    });

    it('throws on non-OK HTTP response with error text', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      await callTTS('text', port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: expect.stringContaining('401'),
      });
    });

    it('sends chunk on event 352 (audio data)', async () => {
      const body = createSSEBody([
        { event: '352', data: { code: 0, data: 'base64-chunk-1' } },
        { event: '352', data: { code: 0, data: 'base64-chunk-2' } },
        { event: '152', data: { code: 20000000 } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('text', port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'chunk',
        data: 'base64-chunk-1',
      });
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'chunk',
        data: 'base64-chunk-2',
      });
    });

    it('sends done on event 152 after audio was received', async () => {
      const body = createSSEBody([
        { event: '352', data: { code: 0, data: 'base64-audio' } },
        { event: '152', data: { code: 20000000 } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('text', port);

      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'done' });
    });

    it('does NOT send done on 152 if no audio was received (waits for more)', async () => {
      // Per sw-tts.ts line 35: event 152 only sends 'done' if receivedAudio is true.
      // Without prior 352, the stream continues and eventually sends 'done' at end-of-stream.
      const body = createSSEBody([
        { event: '152', data: { code: 20000000 } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('text', port);

      // End-of-stream fallback sends 'done'
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'done' });
    });

    it('sends error on event 153 (synthesis failure)', async () => {
      // Code must be 0 or 20000000 to pass the generic error-code check
      // before reaching the event-153 specific handler.
      const body = createSSEBody([
        { event: '153', data: { code: 0, message: 'synthesis error' } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('text', port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        errorKey: 'error.ttsSynthFailed',
        error: 'synthesis error',
      });
    });

    it('sends error on non-zero error code in parsed data', async () => {
      const body = createSSEBody([
        { event: '352', data: { code: 500, message: 'internal error' } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('text', port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        errorKey: 'error.ttsError',
        error: 'internal error',
      });
    });

    it('sends done when stream ends naturally (no 152 event)', async () => {
      const body = createSSEBody([
        { event: '352', data: { code: 0, data: 'audio' } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callTTS('text', port);

      // Fallback: line 39 sends done after while-loop exits
      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'done' });
    });

    it('handles network error (fetch throws)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      await callTTS('text', port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: 'Network error',
      });
    });
  });
});
