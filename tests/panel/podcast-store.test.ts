import { vi, describe, it, expect, beforeEach } from 'vitest';

// chrome must be on globalThis BEFORE the panel stores (→ legacy state.ts)
// are imported: state.ts registers tab lifecycle listeners at module load.
const { store } = vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };

  function createStorageArea(storeKey: string) {
    return {
      get(keys: unknown, cb?: (r: unknown) => void) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store[storeKey][k as string] !== undefined) result[k as string] = store[storeKey][k as string]; });
        if (cb) { cb(result); return; }
        return Promise.resolve(result);
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.entries(items).forEach(([k, v]) => { store[storeKey][k] = v; });
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
      remove(keys: unknown, cb?: () => void) {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[storeKey][k as string]);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
    };
  }

  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect: vi.fn(() => ({
        name: 'ai-chat',
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store };
});

import {
  usePodcastStore,
  getNowPlaying,
  isNowPlayingGenerating,
  isPodcastStatusGenerating,
  subscribePodcastStop,
  stopPodcastForTTS,
} from '@/panel/stores/podcast-store';
import { useTabsStore } from '@/panel/stores/tabs-store';

function seedSession(status: 'generating_script' | 'generating_audio' | 'playing' | 'done' | 'error' = 'playing') {
  usePodcastStore.getState().setNowPlaying({
    originTabId: 42,
    originTabTitle: 'Origin tab',
    title: 'Test podcast',
    script: [{ speaker: 'zh_male_dayixiansheng_v2_saturn_bigtts', text: '你好', speakerLabel: 'A' }],
    status,
  });
}

describe('podcast-store — now-playing registry', () => {
  beforeEach(() => {
    usePodcastStore.getState().clearNowPlaying();
    usePodcastStore.getState().resetPlayback();
  });

  it('setNowPlaying / updateNowPlaying / clearNowPlaying round-trip', () => {
    seedSession('generating_script');
    expect(getNowPlaying()).toMatchObject({ originTabId: 42, status: 'generating_script' });

    usePodcastStore.getState().updateNowPlaying({ status: 'playing', title: 'New title' });
    expect(usePodcastStore.getState().nowPlaying).toMatchObject({ status: 'playing', title: 'New title' });
    // Patch leaves unmentioned fields intact.
    expect(usePodcastStore.getState().nowPlaying?.script).toHaveLength(1);

    usePodcastStore.getState().clearNowPlaying();
    expect(getNowPlaying()).toBeNull();
  });

  it('updateNowPlaying is a no-op when nothing is playing', () => {
    expect(() => usePodcastStore.getState().updateNowPlaying({ title: 'x' })).not.toThrow();
    expect(getNowPlaying()).toBeNull();
  });

  it('isNowPlayingGenerating is true only during the generation phases', () => {
    expect(isNowPlayingGenerating()).toBe(false);
    seedSession('generating_script');
    expect(isNowPlayingGenerating()).toBe(true);
    seedSession('generating_audio');
    expect(isNowPlayingGenerating()).toBe(true);
    seedSession('playing');
    expect(isNowPlayingGenerating()).toBe(false);
    expect(isPodcastStatusGenerating('done')).toBe(false);
    expect(isPodcastStatusGenerating('error')).toBe(false);
  });
});

describe('podcast-store — playback mirror', () => {
  beforeEach(() => {
    usePodcastStore.getState().clearNowPlaying();
    usePodcastStore.getState().resetPlayback();
  });

  it('setPlayback / setRoundTimings / setHasAudio update the mirror', () => {
    const s = usePodcastStore.getState();
    s.setPlayback({ playing: true, currentTime: 12, duration: 340 });
    s.setRoundTimings([{ startTime: 0, endTime: 5 }, { startTime: 5, endTime: 9 }]);
    s.setHasAudio(true);
    const after = usePodcastStore.getState();
    expect(after.playing).toBe(true);
    expect(after.currentTime).toBe(12);
    expect(after.duration).toBe(340);
    expect(after.roundTimings).toHaveLength(2);
    expect(after.hasAudio).toBe(true);
  });

  it('resetPlayback restores the idle mirror without touching nowPlaying', () => {
    seedSession('done');
    usePodcastStore.getState().setPlayback({ playing: true, currentTime: 99, duration: 100 });
    usePodcastStore.getState().setHasAudio(true);
    usePodcastStore.getState().resetPlayback();
    const s = usePodcastStore.getState();
    expect(s.playing).toBe(false);
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
    expect(s.roundTimings).toEqual([]);
    expect(s.hasAudio).toBe(false);
    expect(s.nowPlaying).not.toBeNull();
  });
});

describe('podcast-store — TTS stop signal (PODCAST_STOP_REQUEST equivalent)', () => {
  it('stopPodcastForTTS notifies subscribers; unsubscribe stops delivery', () => {
    const cb = vi.fn();
    const unsubscribe = subscribePodcastStop(cb);
    stopPodcastForTTS();
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    stopPodcastForTTS();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('podcast-store — window-global semantics', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    usePodcastStore.getState().clearNowPlaying();
    usePodcastStore.getState().resetPlayback();
    await useTabsStore.getState().init();
  });

  it('switching tabs does not clear the session or playback state', async () => {
    seedSession('playing');
    usePodcastStore.getState().setPlayback({ playing: true, currentTime: 12, duration: 300 });
    usePodcastStore.getState().setHasAudio(true);

    await useTabsStore.getState().switchToTab(7);

    const s = usePodcastStore.getState();
    // Still the origin tab's session, still playing — background playback.
    expect(s.nowPlaying?.originTabId).toBe(42);
    expect(s.playing).toBe(true);
    expect(s.currentTime).toBe(12);
    expect(s.hasAudio).toBe(true);
  });
});
