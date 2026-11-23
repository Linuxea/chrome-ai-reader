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

// How the fake engine below ends: null = drains normally (no audio); otherwise
// it fails with this message / error key, exactly as the real engine reports
// an exhausted retry: onError(message, errorKey).
const engineEnds = vi.hoisted(() => ({ failWith: null as null | { message: string; errorKey?: string } }));

// Fake synthesis engine: drains instantly, delivers no audio — the playback
// clock never starts, so maybeFinished fires on the zero-segment path.
vi.mock('@/panel/lib/tts/engine', () => {
  class FakeEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private opts: any) {}
    enqueue(): void { /* no segments delivered */ }
    endInput(): void {
      // Drain (or fail) on the next microtask, like the real engine's async flow.
      void Promise.resolve().then(() => {
        if (engineEnds.failWith) this.opts.onError(engineEnds.failWith.message, engineEnds.failWith.errorKey);
        else this.opts.onDrained();
      });
    }
    abort(): void { /* no-op */ }
    notifyProgress(): void { /* no-op */ }
  }
  return { TTSSynthEngine: FakeEngine, getTTSVoice: () => ({}) };
});

import { initTTS, handleTTSButtonClick, handleTTSDownloadClick, stopAllTTS, ttsAutoplayStart, ttsAutoplayAbort } from '@/panel/lib/tts-controller';
import { setTTSAutoPlay } from '@/panel/lib/tts/player';
import { useTTSStore } from '@/panel/stores/tts-store';
import { useUIStore } from '@/panel/stores/ui-store';

describe('TTS natural-finish wiring (full-stop hook)', () => {
  beforeEach(() => {
    engineEnds.failWith = null;
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

// A failed synthesis stops playback. It used to stop SILENTLY — the reason
// only reached the console — so a missing credential (e.g. an App ID wiped by
// Chrome sync) looked like a button that did nothing.
describe('TTS failures are said out loud', () => {
  beforeEach(() => {
    engineEnds.failWith = null;
    useUIStore.setState({ toasts: [] });
    initTTS();
  });

  const lastToast = () => useUIStore.getState().toasts.at(-1);

  it('a missing credential names the fix, not a generic failure', async () => {
    // What the engine reports for the worker's key-only error.
    engineEnds.failWith = { message: 'error.noTtsConfig', errorKey: 'error.noTtsConfig' };
    handleTTSButtonClick({ tabId: 42, msgId: 'm3', markdown: '一段回答' });

    await vi.waitFor(() => expect(lastToast()?.message).toBe('请先在设置页面配置 TTS 语音合成'));
    expect(lastToast()?.kind).toBe('error');
    // …and the playback is still stopped cleanly (no zombie loading).
    await vi.waitFor(() => expect(useTTSStore.getState().playing).toBe(false));
  });

  it('an upstream refusal keeps the API\'s own detail next to the localized class', async () => {
    engineEnds.failWith = { message: 'speaker not found', errorKey: 'error.ttsError' };
    handleTTSButtonClick({ tabId: 42, msgId: 'm4', markdown: '一段回答' });

    await vi.waitFor(() => expect(lastToast()?.message).toBe('TTS 错误：speaker not found'));
  });

  it('a failure without an error key shows the raw message', async () => {
    engineEnds.failWith = { message: 'TTS connection closed' };
    handleTTSButtonClick({ tabId: 42, msgId: 'm5', markdown: '一段回答' });

    await vi.waitFor(() => expect(lastToast()?.message).toBe('TTS connection closed'));
  });

  it('a failed download reports the same reason instead of "API request failed"', async () => {
    engineEnds.failWith = { message: 'error.noTtsConfig', errorKey: 'error.noTtsConfig' };
    handleTTSDownloadClick({ tabId: 42, msgId: 'm6', markdown: '一段回答' });
    expect(useTTSStore.getState().downloading).toEqual({ tabId: 42, msgId: 'm6' });

    await vi.waitFor(() => expect(lastToast()?.message).toBe('请先在设置页面配置 TTS 语音合成'));
    expect(useTTSStore.getState().downloading).toBeNull();
  });

  it('a healthy playback raises no toast', async () => {
    handleTTSButtonClick({ tabId: 42, msgId: 'm7', markdown: '一段回答' });
    await vi.waitFor(() => expect(useTTSStore.getState().playing).toBe(false));
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });
});

// Autoplay claims the audio resource the moment a stream starts. A turn that
// then ends WITHOUT an answer (error, or stopped during the thinking phase)
// never feeds it anything: left alone it stayed on "reading" forever, and the
// next play click only cleared that zombie instead of playing.
describe('autoplay for a turn that produced no answer', () => {
  beforeEach(() => {
    engineEnds.failWith = null;
    useUIStore.setState({ toasts: [] });
    initTTS();
  });
  afterEach(() => {
    setTTSAutoPlay(false);
    stopAllTTS();
  });

  it('releases the playback it claimed at stream start — quietly', () => {
    setTTSAutoPlay(true);
    ttsAutoplayStart(42, 'a1');
    expect(useTTSStore.getState().playing).toBe(true);

    ttsAutoplayAbort('a1');
    expect(useTTSStore.getState().playing).toBe(false);
    // Nothing failed — there is simply nothing to read: no error toast.
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it('with autoplay off there is nothing to release (and it does not start one)', () => {
    ttsAutoplayStart(42, 'a1');
    expect(useTTSStore.getState().playing).toBe(false);
    expect(() => ttsAutoplayAbort('a1')).not.toThrow();
    expect(useTTSStore.getState().playing).toBe(false);
  });

  it('a playback that took the resource meanwhile is not this answer\'s to stop', () => {
    setTTSAutoPlay(true);
    ttsAutoplayStart(42, 'a1');
    ttsAutoplayStart(42, 'a2'); // a later stream took over the window-global resource
    expect(useTTSStore.getState().origin).toEqual({ tabId: 42, msgId: 'a2' });

    ttsAutoplayAbort('a1');
    expect(useTTSStore.getState().playing).toBe(true);
    expect(useTTSStore.getState().origin).toEqual({ tabId: 42, msgId: 'a2' });
  });
});
