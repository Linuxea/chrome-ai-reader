/**
 * F17 cross-surface sync — the contract between the side panel and the
 * fullscreen tab (two extension pages rendering one TabState):
 * state replication (in-place field merge + ownership rules), live stream
 * mirroring, the stop relay, and boot-time in-flight adoption.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// chrome must exist before any module import. Fresh programmable port per
// connect(); storage.onChanged + runtime.onMessage listener registries so
// the sync module can be driven from the "other surface".
const { store, getPort, connectMock, simulateStorageChange, simulateRuntimeMessage, sendMessageMock } = vi.hoisted(() => {
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
  const storageListeners = new Set<unknown>();
  const runtimeListeners = new Set<unknown>();
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
      onChanged: {
        addListener: vi.fn((fn: unknown) => storageListeners.add(fn)),
        removeListener: vi.fn((fn: unknown) => storageListeners.delete(fn)),
      },
    },
    tabs: {
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
      onMessage: {
        addListener: vi.fn((fn: unknown) => runtimeListeners.add(fn)),
        removeListener: vi.fn((fn: unknown) => runtimeListeners.delete(fn)),
      },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return {
    store,
    getPort: () => latestPort,
    connectMock: chrome.runtime.connect as ReturnType<typeof vi.fn>,
    sendMessageMock: chrome.runtime.sendMessage as ReturnType<typeof vi.fn>,
    simulateStorageChange: (changes: Record<string, unknown>, area: string) =>
      storageListeners.forEach(fn => (fn as (c: unknown, a: string) => void)(changes, area)),
    simulateRuntimeMessage: (msg: unknown) =>
      runtimeListeners.forEach(fn => (fn as (m: unknown) => void)(msg)),
  };
});

// In-memory chats-db (jsdom has no IndexedDB) — finalize saves records.
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
  };
});

import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import {
  applyRemoteTabState, installStateSync, adoptStoredInFlightFlag,
  type StreamEndPayload,
} from '@/panel/lib/sync';
import { callAI, ownsGeneration, requestGenerationStop, abortGeneration, STOP_RELAY_GRACE_MS } from '@/panel/lib/stream-controller';
import type { ChatMessage, TabState } from '@/shared/types';

function freshRemote(overrides: Partial<TabState> = {}): TabState {
  return {
    pageContent: '', pageTitle: '', pageExcerpt: '',
    conversationHistory: [], currentChatId: null, chatTitle: '',
    selectedText: '', isGenerating: false, isPodcastGenerating: false,
    imageIndex: 0,
    ...overrides,
  };
}

/** Start a REAL owned stream on this page (programmable port). */
function startOwnedStream(): void {
  void callAI([{ role: 'user', content: '问题' }], 42);
}

let offSync: (() => void) | null = null;

beforeEach(async () => {
  store.session = {}; store.sync = {}; store.local = {};
  connectMock.mockClear();
  sendMessageMock.mockClear();
  useUIStore.setState({ sheet: null, toasts: [] });
  useStreamStore.setState({ streams: {} });
  // A stream a previous test left live would make this page look like the
  // OWNER (the abort registry is module state) — finalize it first.
  if (ownsGeneration(42)) abortGeneration(42);
  useTabsStore.setState({ activeTabId: null, version: 0, isGenerating: false });
  await useTabsStore.getState().init();
  // Quiet the done-path extras (suggestions port, title generation port).
  useTabsStore.getState().setSuggestQuestionsEnabled(false);
  useTabsStore.getState().setConversationHistory([]);
});

afterEach(() => {
  // Sync listeners are chrome-global in the mock — never leak them across tests.
  offSync?.();
  offSync = null;
});

describe('cross-surface sync: state replication', () => {
  it('applies a remote state IN PLACE — same TabState object, fields merged, UI re-renders', () => {
    const before = core.getStateForTab(42)!;
    const versionBefore = useTabsStore.getState().version;
    const msg: ChatMessage = { id: 'u1', role: 'user', content: '远端消息' };

    applyRemoteTabState(42, freshRemote({
      conversationHistory: [msg],
      chatTitle: '远端标题',
      currentChatId: 'chat_x',
      pageContent: '远端页面',
    }));

    // In place: every captured reference (history-ops contract) stays valid.
    expect(core.getStateForTab(42)).toBe(before);
    expect(before.conversationHistory).toHaveLength(1);
    expect(before.chatTitle).toBe('远端标题');
    expect(before.currentChatId).toBe('chat_x');
    expect(before.pageContent).toBe('远端页面');
    // The store bumped so React re-renders from the same object.
    expect(useTabsStore.getState().version).toBeGreaterThan(versionBefore);
  });

  it('a passive surface adopts the remote busy flag — a second send into the same conversation is blocked', () => {
    applyRemoteTabState(42, freshRemote({ isGenerating: true }));
    expect(core.getIsGenerating()).toBe(true);
    expect(useTabsStore.getState().isGenerating).toBe(true);
  });

  it('the surface that OWNS the stream keeps its own flag — a passive self-heal cannot cancel it', () => {
    startOwnedStream();
    expect(ownsGeneration(42)).toBe(true);
    // A passive page's stale "false" write arrives:
    applyRemoteTabState(42, freshRemote({ isGenerating: false }));
    expect(core.getIsGenerating()).toBe(true);
  });

  it('a finished remote stream clears the passive mirror; an error mirror keeps the retry affordance', () => {
    offSync = installStateSync();
    // Mirror a live entry (as the relay would):
    simulateRuntimeMessage({ action: 'sync.streamStart', tabId: 42, assistantId: 'a1' });
    simulateRuntimeMessage({ action: 'sync.stream', tabId: 42, msg: { type: 'chunk', content: '部分' } });
    expect(useStreamStore.getState().streams[42]?.answer).toBe('部分');

    applyRemoteTabState(42, freshRemote({ isGenerating: false }));
    expect(useStreamStore.getState().streams[42]).toBeUndefined();

    // An error entry is NOT cleared by the remote settle — it holds the
    // retryable user turn, exactly like on the owner.
    simulateRuntimeMessage({ action: 'sync.streamStart', tabId: 42, assistantId: 'a2' });
    simulateRuntimeMessage({
      action: 'sync.streamEnd', tabId: 42,
      payload: { kind: 'error', errorText: 'boom', failedUserMessage: { id: 'u2', role: 'user', content: '问' } } as StreamEndPayload,
    });
    applyRemoteTabState(42, freshRemote({ isGenerating: false }));
    expect(useStreamStore.getState().streams[42]?.status).toBe('error');
  });

  it('quiz state applies only when neither side is mid-quiz', () => {
    // Both idle → the remote session (e.g. a load clearing it) applies.
    applyRemoteTabState(42, freshRemote({ quizSession: { generating: false } as never }));
    expect(core.getStateForTab(42)!.quizSession).toBeDefined();

    // Remote mid-quiz → skip (its page is driving the stream).
    applyRemoteTabState(42, freshRemote({ quizSession: { generating: true } as never }));
    expect(core.getStateForTab(42)!.quizSession?.generating).toBe(false);
  });

  it('mirrors only the ACTIVE tab\'s session key, and only the session area', () => {
    offSync = installStateSync();
    useTabsStore.getState().setChatTitle('本地');

    simulateStorageChange({ tabState_99: { newValue: freshRemote({ chatTitle: '别的' }) } }, 'session');
    expect(core.getChatTitle()).toBe('本地');

    simulateStorageChange({ tabState_42: { newValue: freshRemote({ chatTitle: '同步了' }) } }, 'local');
    expect(core.getChatTitle()).toBe('本地');

    simulateStorageChange({ tabState_42: { newValue: freshRemote({ chatTitle: '同步了' }) } }, 'session');
    expect(core.getChatTitle()).toBe('同步了');

    offSync?.();
    offSync = null;
    simulateStorageChange({ tabState_42: { newValue: freshRemote({ chatTitle: '又改了' }) } }, 'session');
    expect(core.getChatTitle()).toBe('同步了');
  });
});

describe('cross-surface sync: live stream mirroring', () => {
  it('a passive surface renders the owner\'s stream as it happens', () => {
    offSync = installStateSync();
    simulateRuntimeMessage({ action: 'sync.streamStart', tabId: 42, assistantId: 'a1' });
    simulateRuntimeMessage({ action: 'sync.stream', tabId: 42, msg: { type: 'thinking', content: '思考' } });
    simulateRuntimeMessage({ action: 'sync.stream', tabId: 42, msg: { type: 'chunk', content: '答案' } });
    simulateRuntimeMessage({
      action: 'sync.stream', tabId: 42,
      msg: { type: 'search_event', event: { type: 'call_started', step: 1, call: { id: 'c1', index: 0, kind: 'search', action: { type: 'search', queries: ['q'] } } } },
    });

    const live = useStreamStore.getState().streams[42]!;
    expect(live.thinking).toBe('思考');
    expect(live.answer).toBe('答案');
    expect(live.webSteps).toHaveLength(1);

    // The worker retried: the mirror resets like the owner's does.
    simulateRuntimeMessage({ action: 'sync.stream', tabId: 42, msg: { type: 'retry' } });
    expect(useStreamStore.getState().streams[42]!.answer).toBe('');
    expect(useStreamStore.getState().streams[42]!.webSteps).toHaveLength(0);

    simulateRuntimeMessage({
      action: 'sync.streamEnd', tabId: 42,
      payload: { kind: 'done', finishReason: 'stop' } as StreamEndPayload,
    });
    expect(useStreamStore.getState().streams[42]!.status).toBe('done');
  });

  it('the owner ignores mirror events — it IS the source', () => {
    offSync = installStateSync();
    startOwnedStream();
    const port = getPort()!;
    port._simulateMessage({ type: 'chunk', content: '本地流' });

    simulateRuntimeMessage({ action: 'sync.stream', tabId: 42, msg: { type: 'chunk', content: '镜像流' } });
    expect(useStreamStore.getState().streams[42]!.answer).toBe('本地流');
  });

  it('relays from the owner actually reach the wire (stream-controller → sendMessage)', () => {
    startOwnedStream();
    const port = getPort()!;
    port._simulateMessage({ type: 'chunk', content: '部分' });
    const relayed = sendMessageMock.mock.calls.map(c => c[0] as { action?: string; tabId?: number; msg?: { content?: string } });
    expect(relayed.some(m => m.action === 'sync.streamStart' && m.tabId === 42)).toBe(true);
    expect(relayed.some(m => m.action === 'sync.stream' && m.msg?.content === '部分')).toBe(true);
  });
});

describe('cross-surface sync: stop relay', () => {
  it('a stop request from a passive surface is honored by the OWNER (partial text is kept)', () => {
    offSync = installStateSync();
    startOwnedStream();
    const port = getPort()!;
    port._simulateMessage({ type: 'chunk', content: '部分答案' });

    simulateRuntimeMessage({ action: 'sync.stopRequest', tabId: 42 });

    // Same contract as a local stop with text: partial kept in history,
    // flag released, stream settled + relayed to the other surfaces.
    expect(core.getStateForTab(42)!.conversationHistory.at(-1)?.content).toBe('部分答案');
    expect(core.getIsGenerating()).toBe(false);
    const relayed = sendMessageMock.mock.calls.map(c => c[0] as { action?: string; payload?: { kind?: string } });
    expect(relayed.some(m => m.action === 'sync.streamEnd' && m.payload?.kind === 'done')).toBe(true);
  });

  it('requestGenerationStop on the OWNER aborts directly — no broadcast', () => {
    startOwnedStream();
    const port = getPort()!;
    port._simulateMessage({ type: 'chunk', content: '部分' });
    sendMessageMock.mockClear();

    requestGenerationStop(42);

    expect(core.getIsGenerating()).toBe(false);
    expect(sendMessageMock.mock.calls.some(c => (c[0] as { action?: string }).action === 'sync.stopRequest')).toBe(false);
  });

  it('a PASSIVE stop broadcasts to the owner and self-heals a stale flag after the grace window', () => {
    vi.useFakeTimers();
    try {
      // A stale adopted flag (the writer's page died mid-stream).
      useTabsStore.getState().setGeneratingForTab(42, true);
      sendMessageMock.mockClear();

      requestGenerationStop(42);
      // The request went out to any live owner…
      expect(sendMessageMock.mock.calls.some(c => (c[0] as { action?: string; tabId?: number }).action === 'sync.stopRequest')).toBe(true);
      // …but nobody owns it here, so the surface stays stuck only for the grace window.
      expect(core.getIsGenerating()).toBe(true);
      vi.advanceTimersByTime(STOP_RELAY_GRACE_MS);
      expect(core.getIsGenerating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a passive surface never registers a junk pending abort (its next send must not be swallowed)', () => {
    offSync = installStateSync();
    useTabsStore.getState().setGeneratingForTab(42, true);
    simulateRuntimeMessage({ action: 'sync.stopRequest', tabId: 42 });
    // Not owning → nothing happened locally; the flag is untouched until the
    // owner's settle (or the self-heal) arrives.
    expect(core.getIsGenerating()).toBe(true);
    expect(useStreamStore.getState().streams[42]).toBeUndefined();
  });
});

describe('boot-time in-flight adoption', () => {
  it('adopts a stored in-flight flag — the sibling surface may be live mid-answer', async () => {
    store.session['tabState_42'] = freshRemote({ isGenerating: true });
    await adoptStoredInFlightFlag(42);
    expect(core.getIsGenerating()).toBe(true);
  });

  it('nothing stored (or owned locally) → no adoption', async () => {
    await adoptStoredInFlightFlag(42);
    expect(core.getIsGenerating()).toBe(false);
  });
});
