/**
 * Tests for background/sw-podcast.ts — Podcast proxy SSE relay.
 *
 * Tests SSE event relaying (audio_chunk/round_start/round_end/done/error),
 * config validation, connectId generation, and proxy-not-reachable handling.
 *
 * Pattern follows sw-openai.test.js: mock chrome.storage, sw-utils, fetch.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mock chrome.storage.sync.get (promise-style) ---
const store: Record<string, unknown> = {
  sync: {
    ttsAppId: 'pod-app-id',
    ttsAccessKey: 'pod-access-key',
    ttsResourceId: 'volc.service_type.10050',
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

import { callPodcast } from '../../src/background/sw-podcast.js';
import { safePostMessage } from '../../src/background/sw-utils.js';

// --- Test helpers ---

function createMockPort() {
  return {
    postMessage: vi.fn(),
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}

/** Build an SSE response body for the podcast proxy format */
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
      for (let i = 0; i < bytes.length; i += 100) {
        controller.enqueue(bytes.slice(i, i + 100));
      }
      controller.close();
    },
  });
}

const sampleNlpTexts = [{ speaker: 'A', text: 'Hello' }];
const sampleAudioConfig = { format: 'mp3', sample_rate: 24000, speech_rate: 1 };

describe('background/sw-podcast', () => {
  let port: ReturnType<typeof createMockPort>;

  beforeEach(() => {
    vi.clearAllMocks();
    port = createMockPort();
    store.sync = {
      ttsAppId: 'pod-app-id',
      ttsAccessKey: 'pod-access-key',
      ttsResourceId: 'volc.service_type.10050',
    };
  });

  describe('config validation', () => {
    it('sends error when ttsAppId is missing', async () => {
      delete (store.sync as Record<string, unknown>).ttsAppId;
      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        errorKey: 'podcast.noTtsConfig',
      });
    });

    it('sends error when ttsAccessKey is missing', async () => {
      delete (store.sync as Record<string, unknown>).ttsAccessKey;
      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        errorKey: 'podcast.noTtsConfig',
      });
    });
  });

  describe('fetch and SSE relay', () => {
    it('sends fetch to localhost:3456/podcast with correct body', async () => {
      const body = createSSEBody([{ event: 'done', data: {} }]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3456/podcast',
        expect.objectContaining({ method: 'POST' }),
      );

      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      const parsed = JSON.parse(fetchCall.body as string);
      expect(parsed.appId).toBe('pod-app-id');
      expect(parsed.accessKey).toBe('pod-access-key');
      expect(parsed.nlpTexts).toEqual(sampleNlpTexts);
      expect(parsed.audioConfig).toEqual(sampleAudioConfig);
      // connectId should be a UUID-like string
      expect(parsed.connectId).toEqual(expect.any(String));
      expect(parsed.connectId.length).toBeGreaterThan(10);
    });

    it('uses default resourceId when not configured', async () => {
      delete (store.sync as Record<string, unknown>).ttsResourceId;

      const body = createSSEBody([{ event: 'done', data: {} }]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      const parsed = JSON.parse(fetchCall.body as string);
      expect(parsed.resourceId).toBe('volc.service_type.10050');
    });

    it('relays audio_chunk events', async () => {
      const body = createSSEBody([
        { event: 'audio_chunk', data: { data: 'base64-audio-1' } },
        { event: 'audio_chunk', data: { data: 'base64-audio-2' } },
        { event: 'done', data: {} },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'audio_chunk',
        data: 'base64-audio-1',
      });
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'audio_chunk',
        data: 'base64-audio-2',
      });
    });

    it('relays round_start events with idx and speaker', async () => {
      const body = createSSEBody([
        { event: 'round_start', data: { idx: 0, speaker: 'A' } },
        { event: 'round_start', data: { idx: 1, speaker: 'B' } },
        { event: 'done', data: {} },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'round_start',
        idx: 0,
        speaker: 'A',
      });
      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'round_start',
        idx: 1,
        speaker: 'B',
      });
    });

    it('relays round_end events with timing data', async () => {
      const body = createSSEBody([
        {
          event: 'round_end',
          data: { audioDuration: 5.2, startTime: 0, endTime: 5.2 },
        },
        { event: 'done', data: {} },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'round_end',
        audioDuration: 5.2,
        startTime: 0,
        endTime: 5.2,
      });
    });

    it('relays done event', async () => {
      const body = createSSEBody([{ event: 'done', data: {} }]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'done' });
    });

    it('relays error event from proxy', async () => {
      const body = createSSEBody([
        { event: 'error', data: { error: 'proxy internal error' } },
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body,
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: 'proxy internal error',
      });
    });
  });

  describe('error handling', () => {
    it('throws on non-OK HTTP response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as Response);

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: expect.stringContaining('500'),
      });
    });

    it('gives helpful message when proxy is not reachable (Failed to fetch)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Failed to fetch'),
      );

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: expect.stringContaining('proxy not reachable'),
      });
    });

    it('passes through generic fetch errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Connection reset'),
      );

      await callPodcast(sampleNlpTexts, sampleAudioConfig, port);

      expect(safePostMessage).toHaveBeenCalledWith(port, {
        type: 'error',
        error: 'Connection reset',
      });
    });
  });
});
