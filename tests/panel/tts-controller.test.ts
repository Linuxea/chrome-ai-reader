import { vi, describe, it, expect, beforeEach } from 'vitest';

// chrome must exist before any module import (controller touches storage).
vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };
  const area = (k: string) => ({
    get(keys: unknown, cb?: (r: unknown) => void) {
      const result: Record<string, unknown> = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (store[k][key as string] !== undefined) result[key as string] = store[k][key as string];
      });
      if (cb) { cb(result); return; }
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>, cb?: () => void) {
      Object.assign(store[k], items);
      if (cb) { cb(); return; }
      return Promise.resolve();
    },
    remove(keys: unknown, cb?: () => void) {
      (Array.isArray(keys) ? keys : [keys]).forEach(key => delete store[k][key as string]);
      if (cb) { cb(); return; }
      return Promise.resolve();
    },
  });
  (globalThis as Record<string, unknown>).chrome = {
    storage: { sync: area('sync'), session: area('session'), local: area('local'), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { onRemoved: { addListener: vi.fn() }, onUpdated: { addListener: vi.fn() }, onActivated: { addListener: vi.fn() } },
    runtime: { connect: vi.fn(), onMessage: { addListener: vi.fn() }, openOptionsPage: vi.fn() },
  };
  return { store };
});

// Fake synthesis engine: drains instantly, delivers no audio — the playback
// clock never starts, so maybeFinished fires on the zero-segment path.
vi.mock('@/panel/lib/tts/engine', () => {
  class FakeEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private opts: any) {}
    enqueue(): void { /* no segments delivered */ }
    endInput(): void {
      // Drain on the next microtask, like the real engine's async flow.
      void Promise.resolve().then(() => this.opts.onDrained());
    }
    abort(): void { /* no-op */ }
    notifyProgress(): void { /* no-op */ }
  }
  return { TTSSynthEngine: FakeEngine, getTTSVoice: () => ({}) };
});

import { initTTS, handleTTSButtonClick, stopAllTTS } from '@/panel/lib/tts-controller';
import { useTTSStore } from '@/panel/stores/tts-store';

describe('TTS natural-finish wiring (full-stop hook)', () => {
  beforeEach(() => {
    initTTS();
  });

  it('playback that drains with no segments stops itself → the indicator state clears', async () => {
    // A regression for the missing setFullStopFn wiring: without it,
    // maybeFinished called a null hook and ttsPlaying stayed true forever.
    handleTTSButtonClick({ tabId: 42, msgId: 'm1', markdown: '一段回答' });
    expect(useTTSStore.getState().playing).toBe(true);

    await vi.waitFor(() => {
      expect(useTTSStore.getState().playing).toBe(false);
    });
  });

  it('a manual stop also clears the state', () => {
    handleTTSButtonClick({ tabId: 42, msgId: 'm2', markdown: '另一段' });
    stopAllTTS();
    expect(useTTSStore.getState().playing).toBe(false);
  });
});
