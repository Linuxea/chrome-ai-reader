import { vi, describe, it, expect, beforeEach } from 'vitest';

// Regression tests for the 2026-11 code-review findings. Fresh port per
// connect() (a shared mock port leaks listeners across tests).
const { store, getPort } = vi.hoisted(() => {
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
      // Extraction path: an UNREADABLE page (chrome:// etc.) fails.
      sendMessage: vi.fn(() => Promise.reject(new Error('Receiving end does not exist'))),
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
  return { store, getPort: () => latestPort };
});

import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { submit, retryMessage } from '@/panel/lib/send';
import { abortGeneration } from '@/panel/lib/stream-controller';

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('code-review regressions', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    useStreamStore.setState({ streams: {} });
    useUIStore.setState({ sheet: null, toasts: [], commandPopup: { open: false, query: '', highlighted: 0 }, shareMsgId: null });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
  });

  it('P0: the newest user message is sent to the model exactly once', async () => {
    useTabsStore.getState().setPageContent('cached');
    useComposerStore.getState().setDraftText('q1');
    await submit();
    await flush();
    getPort()?._simulateMessage({ type: 'done', finishReason: 'stop' });

    useComposerStore.getState().setDraftText('q2');
    await submit();
    await flush();

    const payload = getPort()!.postMessage.mock.calls[0]![0] as { messages: { role: string; content: unknown }[] };
    const userContents = payload.messages
      .filter(m => m.role === 'user')
      .map(m => (typeof m.content === 'string' ? m.content : ''));
    expect(userContents).toEqual(['q1', 'q2']);
    expect(userContents.filter(c => c === 'q2')).toHaveLength(1);
  });

  it('P0: a failure BEFORE the port opens still shows the error + retryable bubble', async () => {
    // No pageContent cache + unreadable page → ensurePageContent throws.
    useComposerStore.getState().setDraftText('on a chrome:// page');
    await submit();
    await flush();

    expect(core.getConversationHistory()).toHaveLength(0);
    const live = useStreamStore.getState().streams[42]!;
    expect(live).toBeDefined(); // the entry must EXIST now (used to no-op)
    expect(live.status).toBe('error');
    expect(live.failedUserMessage).toMatchObject({ role: 'user' });
    expect(core.getIsGenerating()).toBe(false);
  });

  it('P1: stop before the first token keeps the user message visible + retryable', async () => {
    useTabsStore.getState().setPageContent('cached');
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    abortGeneration(42);

    const live = useStreamStore.getState().streams[42]!;
    expect(live.status).toBe('aborted');
    expect(live.failedUserMessage).toMatchObject({ role: 'user', content: 'q' });
    expect(core.getConversationHistory()).toHaveLength(0);
  });

  it('P1: retrying a FAILED image message re-sends its images', async () => {
    useTabsStore.getState().setPageContent('cached');
    useComposerStore.getState().setDraftText('看图');
    useComposerStore.getState().addImages(['data:image/png;base64,AAAA']);
    await submit();
    await flush();
    // Simulate a provider failure after the message (with images) was sent.
    getPort()?._simulateMessage({ type: 'error', error: 'boom' });

    const live = useStreamStore.getState().streams[42]!;
    expect(live.failedUserMessage!.hadImages).toBe(true);

    await retryMessage(live.failedUserMessage!);
    await flush();

    const payload = getPort()!.postMessage.mock.calls[0]![0] as {
      messages: { role: string; content: unknown }[];
    };
    const lastUser = payload.messages.filter(m => m.role === 'user').pop()!;
    expect(typeof lastUser.content).not.toBe('string');
    const parts = lastUser.content as { type: string }[];
    expect(parts.some(p => p.type === 'image_url')).toBe(true);
  });

  it('P1: switchBranch is refused while the tab is generating', async () => {
    useTabsStore.getState().setPageContent('cached');
    useComposerStore.getState().setDraftText('q1');
    await submit();
    await flush();
    expect(core.getIsGenerating()).toBe(true);

    const hist = core.getConversationHistory();
    const anchor = hist[0]!.id!;
    core.getStateForTab(42)!.branches = { [anchor]: { tails: [[{ id: 'x', role: 'assistant', content: 'old' }], null], active: 1 } };
    expect(useTabsStore.getState().switchBranch(anchor, 0)).toBe(false);
  });

  it('P1: a quick command with no extra text does NOT re-attach the slash draft', async () => {
    useTabsStore.getState().setPageContent('cached');
    useTabsStore.setState({ quickCommands: [{ id: 'c1', name: '总结', prompt: 'SUMMARIZE', icon: '' }] });
    useComposerStore.getState().setDraftText('/总结');
    await submit({ prompt: 'SUMMARIZE', display: '总结', draft: '' });
    await flush();

    const payload = getPort()!.postMessage.mock.calls[0]![0] as { messages: { role: string; content: unknown }[] };
    const user = payload.messages.filter(m => m.role === 'user').pop()!;
    expect(user.content).toBe('SUMMARIZE'); // no "/总结" supplement appended
  });
});
