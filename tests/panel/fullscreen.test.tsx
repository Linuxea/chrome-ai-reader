/**
 * F17 fullscreen mode — the detach entry (side panel), the fullscreen page
 * URL contract, and the fullscreen layout's own behaviors (sidebar history,
 * new chat, settings entry, binding to the conversation's tab).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { store, getPort, connectMock, createMock, openOptionsMock, queryMock } = vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };
  function createStorageArea(storeKey: string) {
    return {
      get(keys: unknown, cb?: (r: unknown) => void) {
        const result: Record<string, unknown> = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (store[storeKey][k as string] !== undefined) result[k as string] = store[storeKey][k as string];
        });
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
  function makePort() {
    const listeners = { onMessage: new Set<unknown>(), onDisconnect: new Set<unknown>() };
    return {
      name: 'ai-chat',
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn((fn: unknown) => listeners.onMessage.add(fn)), removeListener: vi.fn() },
      onDisconnect: { addListener: vi.fn((fn: unknown) => listeners.onDisconnect.add(fn)), removeListener: vi.fn() },
      disconnect: vi.fn(),
      _simulateMessage: (msg: unknown) => listeners.onMessage.forEach(fn => (fn as (m: unknown) => void)(msg)),
      _simulateDisconnect: () => listeners.onDisconnect.forEach(fn => (fn as () => void)()),
    };
  }
  let latestPort: ReturnType<typeof makePort> | null = null;
  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      // The "browser active tab" — the fullscreen-bind test overrides this
      // once so tabs.query resolves to the fullscreen tab ITSELF (77).
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      get: vi.fn((id: number) => Promise.resolve({ id, url: 'https://example.com/page' })),
      create: vi.fn(() => Promise.resolve({ id: 99 })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect: vi.fn(() => { latestPort = makePort(); return latestPort; }),
      sendMessage: vi.fn(() => Promise.resolve()),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(() => Promise.resolve()),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return {
    store,
    getPort: () => latestPort,
    connectMock: chrome.runtime.connect as ReturnType<typeof vi.fn>,
    createMock: chrome.tabs.create as ReturnType<typeof vi.fn>,
    openOptionsMock: chrome.runtime.openOptionsPage as ReturnType<typeof vi.fn>,
    queryMock: chrome.tabs.query as ReturnType<typeof vi.fn>,
  };
});

// In-memory chats-db (jsdom has no IndexedDB).
vi.mock('@/shared/chats-db', () => {
  const records = new Map<string, Record<string, unknown>>();
  return {
    LEGACY_CHATS_KEY: 'chatHistories',
    MAX_CHATS: 300,
    listChats: vi.fn(async () => [...records.values()]),
    getChat: vi.fn(async (id: string) => records.get(id)),
    putChat: vi.fn(async (chat: Record<string, unknown>) => { records.set(chat.id as string, chat); }),
    deleteChatRecord: vi.fn(async (id: string) => { records.delete(id); }),
    migrateLegacyChats: vi.fn(async () => {}),
    __resetChatRecords: () => records.clear(),
    __putRecord: (chat: Record<string, unknown>) => records.set(chat.id as string, chat),
  };
});

import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { ownsGeneration, abortGeneration } from '@/panel/lib/stream-controller';
import { parseFullscreenUrl, fullscreenPageUrl, openFullscreenChat } from '@/panel/lib/fullscreen';
import { __resetChatRecords, __putRecord } from '@/shared/chats-db';
import { FullscreenApp } from '@/panel/FullscreenApp';
import { Header } from '@/panel/components/layout/Header';

const EXT_URL = 'chrome-extension://abc/src/panel/index.html';

beforeEach(async () => {
  store.session = {}; store.sync = {}; store.local = {};
  __resetChatRecords();
  connectMock.mockClear();
  createMock.mockClear();
  openOptionsMock.mockClear();
  useUIStore.setState({ sheet: null, toasts: [] });
  useStreamStore.setState({ streams: {} });
  if (ownsGeneration(42)) abortGeneration(42);
  useTabsStore.setState({ activeTabId: null, version: 0, isGenerating: false });
  await useTabsStore.getState().init();
  useTabsStore.getState().setSuggestQuestionsEnabled(false);
  useTabsStore.getState().setConversationHistory([]);
  // parseFullscreenUrl / fullscreenPageUrl read the runtime URL — pin it.
  (chrome.runtime as unknown as { getURL: (p: string) => string }).getURL = (p: string) => `chrome-extension://abc/${p}`;
});

describe('fullscreen URL contract', () => {
  it('builds the fullscreen URL for a conversation tab', () => {
    expect(fullscreenPageUrl(42)).toBe(`${EXT_URL}?full=1&tab=42`);
  });

  it('recognizes our own fullscreen page and extracts the bound tab', () => {
    expect(parseFullscreenUrl(`${EXT_URL}?full=1&tab=42`)).toBe(42);
    expect(parseFullscreenUrl(`${EXT_URL}?tab=42`)).toBeNull();          // not fullscreen
    expect(parseFullscreenUrl('https://example.com/page')).toBeNull();   // foreign page
    expect(parseFullscreenUrl(`${EXT_URL}?full=1&tab=0`)).toBeNull();    // no tab id
    expect(parseFullscreenUrl(undefined)).toBeNull();
  });
});

describe('detach: the side panel opens the fullscreen tab', () => {
  it('flushes the debounced state FIRST, then opens ?full=1&tab=<active>', async () => {
    // A pending (debounced) field write must be on disk before the other
    // page boots, or the detached conversation misses it.
    useTabsStore.getState().setChatTitle('待同步标题');
    expect((store.session['tabState_42'] as { chatTitle?: string } | undefined)?.chatTitle).not.toBe('待同步标题');

    await openFullscreenChat();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0]).toEqual({ url: `${EXT_URL}?full=1&tab=42`, active: true });
    expect((store.session['tabState_42'] as { chatTitle?: string }).chatTitle).toBe('待同步标题');
  });

  it('the header offers the detach button and routes through the same entry', async () => {
    render(<Header />);
    fireEvent.click(screen.getByTitle('全屏模式（新标签页，与侧边栏实时同步）'));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect((createMock.mock.calls[0]![0] as { url: string }).url).toContain('?full=1&tab=42');
  });
});

describe('FullscreenApp', () => {
  it('binds the CONVERSATION\'s tab (the URL param), never itself', async () => {
    // The browser's active tab IS the fullscreen page (77): tabs.query
    // resolves to it, and the explicit URL binding must still win.
    queryMock.mockImplementationOnce(() => Promise.resolve([{ id: 77 }]));
    render(<FullscreenApp bindTabId={42} />);
    // tabs.query resolves to the fullscreen tab itself (77) — the explicit
    // binding must win or the page would render an empty conversation.
    await waitFor(() => expect(useTabsStore.getState().activeTabId).toBe(42));
    expect(core.getActiveTabId()).toBe(42);
  });

  it('renders the chat shell: brand, new chat, history list, settings entry', async () => {
    __putRecord({
      id: 'chat_seed', title: '量子纠缠入门', updatedAt: 1_700_000_000_000,
      conversationHistory: [{ id: 'u1', role: 'user', content: '什么是量子纠缠？' }],
      messages: [], createdAt: 1, pageTitle: '', pageUrl: '',
    });
    render(<FullscreenApp bindTabId={42} />);
    await waitFor(() => expect(useTabsStore.getState().activeTabId).toBe(42));

    // Sidebar: brand + new chat + history list + footer entries.
    expect(screen.getByText('小🍐子')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建聊天/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('量子纠缠入门')).toBeInTheDocument());
    expect(screen.getByText('历史对话')).toBeInTheDocument();
    // Main: the conversation title placeholder.
    expect(screen.getByRole('button', { name: '重命名对话' }).textContent).toBe('新对话');

    // Settings entry opens the existing options page.
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(openOptionsMock).toHaveBeenCalledTimes(1);
  });

  it('clicking a history item loads that conversation into the bound tab', async () => {
    __putRecord({
      id: 'chat_seed', title: '量子纠缠入门', updatedAt: 1_700_000_000_000,
      conversationHistory: [
        { id: 'u1', role: 'user', content: '什么是量子纠缠？' },
        { id: 'a1', role: 'assistant', content: '一种量子关联。' },
      ],
      messages: [], createdAt: 1, pageTitle: '', pageUrl: '',
    });
    render(<FullscreenApp bindTabId={42} />);
    await waitFor(() => expect(screen.getByText('量子纠缠入门')).toBeInTheDocument());

    fireEvent.click(screen.getByText('量子纠缠入门'));

    await waitFor(() => {
      expect(core.getStateForTab(42)!.conversationHistory).toHaveLength(2);
      expect(core.getStateForTab(42)!.chatTitle).toBe('量子纠缠入门');
      expect(core.getStateForTab(42)!.currentChatId).toBe('chat_seed');
    });
    // The loaded chat is marked as the active one in the sidebar.
    await waitFor(() => expect(document.querySelector('.history-item-main.active')).toBeInTheDocument());
  });

  it('new chat resets the conversation (the same action as the side panel header)', async () => {
    useTabsStore.getState().setConversationHistory([
      { id: 'u1', role: 'user', content: '旧对话' },
    ]);
    useTabsStore.getState().setChatTitle('旧标题');
    render(<FullscreenApp bindTabId={42} />);
    await waitFor(() => expect(useTabsStore.getState().activeTabId).toBe(42));

    fireEvent.click(screen.getByRole('button', { name: /新建聊天/ }));

    await waitFor(() => {
      expect(core.getStateForTab(42)!.conversationHistory).toHaveLength(0);
      expect(core.getStateForTab(42)!.chatTitle).toBe('');
      expect(core.getStateForTab(42)!.currentChatId).toBeNull();
    });
    expect(screen.getByRole('button', { name: '重命名对话' }).textContent).toBe('新对话');
  });
});
