import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

import { PodcastCard } from '@/panel/components/panels/PodcastCard';
import { PodcastMiniPlayer } from '@/panel/components/panels/PodcastMiniPlayer';
import { usePodcastStore, type NowPlaying, type NlpRound } from '@/panel/stores/podcast-store';
import { useTabsStore } from '@/panel/stores/tabs-store';

const rounds = (n: number): NlpRound[] =>
  Array.from({ length: n }, (_, i) => ({
    speaker: i % 2 === 0 ? 'zh_male_dayixiansheng_v2_saturn_bigtts' : 'zh_female_mizaitongxue_v2_saturn_bigtts',
    text: `第${i + 1}句`,
    speakerLabel: i % 2 === 0 ? 'A' : 'B',
  }));

function seedSession(overrides: Partial<NowPlaying> = {}) {
  usePodcastStore.getState().setNowPlaying({
    originTabId: 42,
    originTabTitle: 'Origin tab',
    title: '测试播客',
    script: rounds(2),
    status: 'playing',
    ...overrides,
  });
}

describe('PodcastCard', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    usePodcastStore.getState().clearNowPlaying();
    usePodcastStore.getState().resetPlayback();
    await useTabsStore.getState().init();
  });

  it('renders nothing without an active session', () => {
    const { container } = render(<PodcastCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the generating status on the origin tab', () => {
    seedSession({ title: '', script: [], status: 'generating_script' });
    render(<PodcastCard />);
    expect(screen.getByText('播客')).toBeTruthy(); // card title
    expect(screen.getByText('正在生成对话脚本...')).toBeTruthy();
  });

  it('shows the player row with play/pause title while playing', () => {
    seedSession();
    usePodcastStore.getState().setPlayback({ playing: true, currentTime: 5, duration: 60 });
    render(<PodcastCard />);
    expect(screen.getByTitle('暂停')).toBeTruthy();
    expect(screen.getByText(/0:05 \/ 1:00/)).toBeTruthy();
  });

  it('done status offers replay + download when audio is buffered', () => {
    seedSession({ status: 'done' });
    usePodcastStore.getState().setHasAudio(true);
    render(<PodcastCard />);
    expect(screen.getByText('播放完成')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新播放' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载音频' })).toBeTruthy();
  });

  it('error status shows the message and a retry button', () => {
    seedSession({ status: 'error', statusText: '合成失败' });
    render(<PodcastCard />);
    expect(screen.getByText('合成失败')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
  });

  it('transcript collapses past 4 rounds and toggles', () => {
    seedSession({ script: rounds(6) });
    render(<PodcastCard />);
    expect(screen.getByText('第1句')).toBeTruthy();
    expect(screen.queryByText('第6句')).toBeNull();
    fireEvent.click(screen.getByText('展开脚本'));
    expect(screen.getByText('第6句')).toBeTruthy();
    expect(screen.getByText('收起脚本')).toBeTruthy();
  });

  it('renders nothing on a NON-origin tab (background playback)', async () => {
    seedSession();
    await useTabsStore.getState().switchToTab(7);
    const { container } = render(<PodcastCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('close button clears the session (full stop)', async () => {
    seedSession();
    render(<PodcastCard />);
    fireEvent.click(screen.getByTitle('关闭'));
    await vi.waitFor(() => expect(usePodcastStore.getState().nowPlaying).toBeNull());
  });
});

describe('PodcastMiniPlayer', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    usePodcastStore.getState().clearNowPlaying();
    usePodcastStore.getState().resetPlayback();
    await useTabsStore.getState().init();
  });

  it('renders nothing without a session and on the origin tab', () => {
    const { container } = render(<PodcastMiniPlayer />);
    expect(container).toBeEmptyDOMElement();

    seedSession();
    const { container: originContainer } = render(<PodcastMiniPlayer />);
    expect(originContainer).toBeEmptyDOMElement(); // the card covers the origin tab
  });

  it('appears on other tabs with the session title and a close button', async () => {
    seedSession();
    await useTabsStore.getState().switchToTab(7);
    render(<PodcastMiniPlayer />);
    expect(screen.getByText('测试播客')).toBeTruthy();
    expect(screen.getByTitle('关闭')).toBeTruthy();
  });

  it('shows the generating spinner text while the session generates', async () => {
    seedSession({ title: '', script: [], status: 'generating_audio' });
    await useTabsStore.getState().switchToTab(7);
    render(<PodcastMiniPlayer />);
    expect(screen.getByText('正在生成播客…')).toBeTruthy(); // podcast.miniGenerating
    expect(screen.getByTitle('播放')).toBeDisabled();
  });

  it('survives further tab switches (window-global)', async () => {
    seedSession();
    await useTabsStore.getState().switchToTab(7);
    const { unmount } = render(<PodcastMiniPlayer />);
    await useTabsStore.getState().switchToTab(9);
    // Re-render cycle: unmount + mount again (as a tab switch re-renders the panel)
    unmount();
    render(<PodcastMiniPlayer />);
    expect(screen.getByText('测试播客')).toBeTruthy();
    expect(usePodcastStore.getState().nowPlaying?.originTabId).toBe(42);
  });
});
