import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// chrome must exist before any module import (state registers lifecycle
// listeners at load). Fresh programmable port per connect() so listeners
// never leak across tests.
const { store, getPort, connectMock } = vi.hoisted(() => {
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
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect: vi.fn(() => { latestPort = makePort(); return latestPort; }),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store, getPort: () => latestPort, connectMock: chrome.runtime.connect as ReturnType<typeof vi.fn> };
});

// In-memory chats-db (jsdom has no IndexedDB) — lets the tests pin the
// record-title propagation through the real save queue.
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
    __records: records,
  };
});

import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { ensureChatTitle, cleanTitle, parseGeneratedTitle } from '@/panel/lib/chat-title';
import { saveCurrentChat, syncChatTitleToRecord } from '@/panel/lib/chat-save';
import { ttsDownloadFilename } from '@/panel/lib/tts-controller';
import { getChat, __resetChatRecords } from '@/shared/chats-db';
import { Header } from '@/panel/components/layout/Header';

/** The standard first exchange used by the generation tests. */
function seedConversation(): void {
  useTabsStore.getState().setConversationHistory([
    { id: 'u1', role: 'user', content: '什么是量子纠缠？', meta: { rawText: '什么是量子纠缠？', displayText: '什么是量子纠缠？' } },
    { id: 'a1', role: 'assistant', content: '量子纠缠是两个粒子之间的量子关联……' },
  ]);
}

describe('chat title: parsing + cleaning', () => {
  it('parseGeneratedTitle reads the JSON the generator produces, across chunk splits', () => {
    expect(parseGeneratedTitle('{"title": "量子纠缠入门"}')).toBe('量子纠缠入门');
    expect(parseGeneratedTitle('好的，这是标题：{"title": "Deep Dive"}')).toBe('Deep Dive');
    expect(parseGeneratedTitle('{"title": null}')).toBeNull();
    expect(parseGeneratedTitle('no json here')).toBeNull();
    expect(parseGeneratedTitle('{"answer": "x"}')).toBeNull();
  });

  it('cleanTitle strips wrapping quotes / title marks / trailing punctuation and caps length', () => {
    expect(cleanTitle('《量子纠缠》')).toBe('量子纠缠');
    expect(cleanTitle('" entanglement basics "')).toBe('entanglement basics');
    expect(cleanTitle('量子纠缠入门。！')).toBe('量子纠缠入门');
    expect(cleanTitle('  ')).toBe('');
    expect(cleanTitle('a'.repeat(60))).toHaveLength(40);
  });
});

describe('chat title: generation flow', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    __resetChatRecords();
    connectMock.mockClear();
    useUIStore.setState({ sheet: null, toasts: [] });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setChatTitle('');
    useTabsStore.getState().setPageTitle('');
  });

  it('posts a JSON-mode request built from the first exchange (page title included)', () => {
    seedConversation();
    useTabsStore.getState().setPageTitle('量子力学导论');

    ensureChatTitle(42);

    const req = getPort()!.postMessage.mock.calls[0]![0] as {
      type: string;
      response_format?: { type: string };
      messages: { role: string; content: string }[];
    };
    expect(req.type).toBe('chat');
    expect(req.response_format).toEqual({ type: 'json_object' });
    expect(req.messages[0]!.role).toBe('system');
    expect(req.messages[1]!.role).toBe('user');
    expect(req.messages[1]!.content).toContain('什么是量子纠缠？');
    expect(req.messages[1]!.content).toContain('量子力学导论');
    // The answer body is part of the material.
    expect(req.messages[1]!.content).toContain('量子关联');
  });

  it('lands the title in the tab state when done arrives', () => {
    seedConversation();
    ensureChatTitle(42);
    const port = getPort()!;

    port._simulateMessage({ type: 'chunk', content: '{"title": ' });
    port._simulateMessage({ type: 'chunk', content: '"量子纠缠入门"}' });
    port._simulateMessage({ type: 'done' });

    expect(core.getStateForTab(42)!.chatTitle).toBe('量子纠缠入门');
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('does not regenerate once a title exists (manual rename wins)', () => {
    seedConversation();
    useTabsStore.getState().setChatTitle('我起的名字');
    const before = connectMock.mock.calls.length;

    ensureChatTitle(42);

    expect(connectMock.mock.calls.length).toBe(before);
  });

  it('a provider error is quiet: no title, port closed, no toast', () => {
    seedConversation();
    ensureChatTitle(42);

    getPort()!._simulateMessage({ type: 'error', error: 'boom' });

    expect(core.getStateForTab(42)!.chatTitle).toBe('');
    expect(getPort()!.disconnect).toHaveBeenCalled();
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it('a worker retry mid-generation resets the buffer — the dead attempt\'s fragments do not pollute the JSON', () => {
    seedConversation();
    ensureChatTitle(42);
    const port = getPort()!;

    // First attempt drops after a partial chunk; the worker restarts.
    port._simulateMessage({ type: 'chunk', content: '{"ti' });
    port._simulateMessage({ type: 'retry' });
    port._simulateMessage({ type: 'chunk', content: '{"title": "网络故障后的标题"}' });
    port._simulateMessage({ type: 'done' });

    expect(core.getStateForTab(42)!.chatTitle).toBe('网络故障后的标题');
  });

  it('a title arriving after the conversation moved on is discarded (staleness guard)', () => {
    seedConversation();
    ensureChatTitle(42);
    const port = getPort()!;

    // The user started a new chat before the answer arrived.
    useTabsStore.getState().clearConversation();

    port._simulateMessage({ type: 'chunk', content: '{"title": "旧话题"}' });
    port._simulateMessage({ type: 'done' });

    expect(core.getStateForTab(42)!.chatTitle).toBe('');
  });

  it('a kept partial answer (stop with text) is still a titleable exchange', () => {
    // Only the user question exists → no exchange yet → no request.
    useTabsStore.getState().setConversationHistory([
      { id: 'u1', role: 'user', content: '只有问题' },
    ]);
    const before = connectMock.mock.calls.length;
    ensureChatTitle(42);
    expect(connectMock.mock.calls.length).toBe(before);
  });
});

describe('chat title: record propagation (unified with history list)', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    __resetChatRecords();
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([
      { id: 'u1', role: 'user', content: '什么是量子纠缠？', meta: { rawText: '什么是量子纠缠？', displayText: '什么是量子纠缠？' } },
    ]);
    useTabsStore.getState().setChatTitle('');
    useTabsStore.getState().setCurrentChatId(null);
  });

  it('a first save without a title keeps the first-user heuristic', async () => {
    await saveCurrentChat(42);
    const chatId = core.getStateForTab(42)!.currentChatId!;
    const record = await getChat(chatId);
    expect(record!.title).toBe('什么是量子纠缠？');
  });

  it('a first save WITH a live title uses it', async () => {
    useTabsStore.getState().setChatTitle('量子纠缠入门');
    await saveCurrentChat(42);
    const chatId = core.getStateForTab(42)!.currentChatId!;
    const record = await getChat(chatId);
    expect(record!.title).toBe('量子纠缠入门');
  });

  it('a later save propagates a rename into the existing record', async () => {
    await saveCurrentChat(42);
    const chatId = core.getStateForTab(42)!.currentChatId!;

    useTabsStore.getState().setChatTitle('改后的名字');
    await saveCurrentChat(42);

    const record = await getChat(chatId);
    expect(record!.title).toBe('改后的名字');
  });

  it('syncChatTitleToRecord rewrites the record after the title lands post-save', async () => {
    await saveCurrentChat(42);
    const chatId = core.getStateForTab(42)!.currentChatId!;
    expect((await getChat(chatId))!.title).toBe('什么是量子纠缠？');

    // The LLM title arrives after the save (generation is slower).
    core.setChatTitleForTab(42, '量子纠缠入门');
    syncChatTitleToRecord(42);

    await vi.waitFor(async () => {
      expect((await getChat(chatId))!.title).toBe('量子纠缠入门');
    });
  });

  it('ensureChatTitle end-to-end: generation updates the already-saved record', async () => {
    await saveCurrentChat(42);
    const chatId = core.getStateForTab(42)!.currentChatId!;

    // The kept answer completes the exchange → finalize's ensureChatTitle.
    useTabsStore.getState().appendMessage({ id: 'a1', role: 'assistant', content: '量子纠缠是……' });
    ensureChatTitle(42);

    const port = getPort()!;
    port._simulateMessage({ type: 'chunk', content: '{"title": "量子纠缠入门"}' });
    port._simulateMessage({ type: 'done' });

    expect(core.getStateForTab(42)!.chatTitle).toBe('量子纠缠入门');
    await vi.waitFor(async () => {
      expect((await getChat(chatId))!.title).toBe('量子纠缠入门');
    });
  });
});

describe('chat title: TTS download filename', () => {
  it('uses the sanitized conversation title with a date suffix', () => {
    const now = new Date('2026-11-28T10:30:00Z');
    expect(ttsDownloadFilename('量子纠缠入门', now)).toBe('量子纠缠入门_2026-11-28.mp3');
    // Reserved filename characters are stripped by sanitizeFilename.
    expect(ttsDownloadFilename('a/b:c?', now)).toBe('a_b_c__2026-11-28.mp3');
  });

  it('falls back to the legacy timestamped name without a title', () => {
    const now = new Date('2026-11-28T10:30:00Z');
    expect(ttsDownloadFilename('', now)).toBe('voice-2026-11-28T10-30-00.mp3');
    expect(ttsDownloadFilename('   ', now)).toBe('voice-2026-11-28T10-30-00.mp3');
  });
});

describe('chat title: header display + rename', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    __resetChatRecords();
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setChatTitle('');
    useUIStore.setState({ sheet: null, toasts: [] });
  });

  it('shows the conversation title, or the i18n placeholder when there is none', () => {
    const { rerender } = render(<Header />);
    expect(screen.getByRole('button', { name: '重命名对话' }).textContent).toBe('新对话');

    useTabsStore.getState().setChatTitle('量子纠缠入门');
    rerender(<Header />);
    expect(screen.getByRole('button', { name: '重命名对话' }).textContent).toBe('量子纠缠入门');
  });

  it('click → rename inline → Enter commits into the tab state (IME-safe)', () => {
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: '重命名对话' }));

    const input = screen.getByLabelText('重命名对话') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '我的量子笔记' } });
    // An IME composition Enter must NOT commit.
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(core.getStateForTab(42)!.chatTitle).toBe('');
    // The real Enter does.
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(core.getStateForTab(42)!.chatTitle).toBe('我的量子笔记');
    expect(screen.getByRole('button', { name: '重命名对话' }).textContent).toBe('我的量子笔记');
  });

  it('Escape cancels the rename; an empty commit keeps the previous title', () => {
    useTabsStore.getState().setChatTitle('原标题');
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: '重命名对话' }));

    const input = screen.getByLabelText('重命名对话') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(core.getStateForTab(42)!.chatTitle).toBe('原标题');

    fireEvent.click(screen.getByRole('button', { name: '重命名对话' }));
    const again = screen.getByLabelText('重命名对话') as HTMLInputElement;
    fireEvent.change(again, { target: { value: '不要了' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(core.getStateForTab(42)!.chatTitle).toBe('原标题');
    expect(screen.getByRole('button', { name: '重命名对话' }).textContent).toBe('原标题');
  });

  it('new chat resets the title back to the placeholder', async () => {
    useTabsStore.getState().setChatTitle('旧对话标题');
    useTabsStore.getState().setConversationHistory([
      { id: 'u1', role: 'user', content: 'hi', meta: { rawText: 'hi', displayText: 'hi' } },
    ]);
    render(<Header />);

    fireEvent.click(screen.getByTitle('新建聊天'));

    expect(core.getStateForTab(42)!.chatTitle).toBe('');
    expect(core.getStateForTab(42)!.conversationHistory).toHaveLength(0);
    expect(screen.getByRole('button', { name: '重命名对话' }).textContent).toBe('新对话');
  });
});
