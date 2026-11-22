import { vi, describe, it, expect, beforeEach } from 'vitest';

// chrome mock BEFORE any panel/legacy import (state.ts registers tab
// lifecycle listeners at module load). Port mock is programmable so tests
// can simulate the SW side of the ai-chat port.
const { store, connectMock, getPort } = vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };

  function createStorageArea(storeKey: string) {
    return {
      get(keys: unknown, cb?: (r: unknown) => void) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
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
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete store[storeKey][k as string]);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
    };
  }

  // A FRESH port per connect() call — a shared port would leak listeners
  // from earlier tests into later ones (they share the mock bus).
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
  const connectMock = vi.fn(() => { latestPort = makePort(); return latestPort; });

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
      connect: connectMock,
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store, connectMock, getPort: () => latestPort! };
});

import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { submit } from '@/panel/lib/send';
import { abortGeneration } from '@/panel/lib/stream-controller';

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('panel send pipeline', () => {
  beforeEach(async () => {
    store.session = {};
    store.sync = {};
    store.local = {};
    connectMock.mockClear();
    getPort()?.postMessage.mockClear();
    useStreamStore.setState({ streams: {} });
    useUIStore.setState({ sheet: null, toasts: [], commandPopup: { open: false, query: '', highlighted: 0 } });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    // Cache page content so ensurePageContent skips extraction + messaging.
    useTabsStore.getState().setPageContent('cached page');
    useTabsStore.getState().setPageTitle('T');
  });

  it('free-text send: user message into history, port opened, generating set', async () => {
    useComposerStore.getState().setDraftText('  hello world  ');
    await submit();
    await flush();

    const hist = core.getConversationHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ role: 'user', content: 'hello world' });
    expect(hist[0]!.meta).toMatchObject({ rawText: 'hello world', displayText: 'hello world' });
    expect(useComposerStore.getState().draftText).toBe('');
    expect(connectMock).toHaveBeenCalledWith({ name: 'ai-chat' });
    expect(getPort().postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    expect(core.getIsGenerating()).toBe(true);
    expect(useStreamStore.getState().streams[42]?.status).toBe('streaming');
  });

  it('empty draft with no attachments is a no-op', async () => {
    await submit();
    await flush();
    expect(core.getConversationHistory()).toHaveLength(0);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('image-only send is valid (content parts, no text part)', async () => {
    useComposerStore.getState().addImages(['data:image/png;base64,AAAA']);
    await submit();
    await flush();
    const msg = core.getConversationHistory()[0]!;
    expect(msg.role).toBe('user');
    expect(typeof msg.content).not.toBe('string');
    expect(msg.hadImages).toBe(true);
  });

  it('oversized attachments are refused and stay in the composer', async () => {
    useComposerStore.getState().addImages(['data:' + 'x'.repeat(11 * 1024 * 1024)]);
    await submit();
    await flush();
    expect(core.getConversationHistory()).toHaveLength(0);
    expect(connectMock).not.toHaveBeenCalled();
    expect(useComposerStore.getState().images).toHaveLength(1);
    expect(useUIStore.getState().toasts.length).toBeGreaterThan(0);
  });

  it('prompt intent rides the draft along as extra instructions', async () => {
    useComposerStore.getState().setDraftText('keep it short');
    await submit({ prompt: 'SUMMARIZE', display: '总结' });
    await flush();
    const msg = core.getConversationHistory()[0]!;
    expect(msg.content).toContain('SUMMARIZE');
    expect(msg.content).toContain('keep it short');
    expect(msg.meta!.displayText).toContain('总结');
    expect(msg.meta!.displayText).toContain('keep it short');
  });

  it('quote is attached to the message and cleared from state after send', async () => {
    useTabsStore.getState().setSelectedText('a selected passage');
    useComposerStore.getState().setDraftText('explain this');
    await submit();
    await flush();
    const msg = core.getConversationHistory()[0]!;
    expect(msg.content).toContain('a selected passage');
    expect(msg.meta!.quote).toBe('a selected passage');
    expect(core.getSelectedText()).toBe('');
  });

  it('submit is rejected while a generation is running', async () => {
    useComposerStore.getState().setDraftText('first');
    await submit();
    await flush();
    useComposerStore.getState().setDraftText('second');
    await submit();
    await flush();
    const hist = core.getConversationHistory();
    expect(hist.filter(m => m.content === 'second')).toHaveLength(0);
  });

  it('done outcome folds the assistant answer into history', async () => {
    useComposerStore.getState().setDraftText('hi');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'chunk', content: 'Hel' });
    getPort()._simulateMessage({ type: 'chunk', content: 'lo' });
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2 }, model: 'm' });

    const hist = core.getConversationHistory();
    expect(hist).toHaveLength(2);
    expect(hist[1]).toMatchObject({ role: 'assistant', content: 'Hello' });
    expect(useStreamStore.getState().streams[42]).toBeUndefined();
    expect(core.getIsGenerating()).toBe(false);
  });

  it('error outcome rolls the user turn back and keeps it retryable on the stream entry', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'error', error: 'boom' });

    expect(core.getConversationHistory()).toHaveLength(0);
    const live = useStreamStore.getState().streams[42]!;
    expect(live.status).toBe('error');
    expect(live.error).toBe('boom');
    expect(live.failedUserMessage).toMatchObject({ role: 'user', content: 'q' });
    expect(core.getIsGenerating()).toBe(false);
  });

  it('stop before any text rolls back the turn and leaves a quiet note', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    abortGeneration(42);

    expect(core.getConversationHistory()).toHaveLength(0);
    const live = useStreamStore.getState().streams[42]!;
    expect(live.status).toBe('aborted');
    expect(live.note).toBeTruthy();
    expect(getPort().disconnect).toHaveBeenCalled();
    expect(core.getIsGenerating()).toBe(false);
  });

  it('stop AFTER partial text keeps the partial answer in history', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'chunk', content: 'partial answer' });
    abortGeneration(42);

    const hist = core.getConversationHistory();
    expect(hist).toHaveLength(2);
    expect(hist[1]).toMatchObject({ role: 'assistant', content: 'partial answer' });
    expect(useStreamStore.getState().streams[42]).toBeUndefined();
    expect(core.getIsGenerating()).toBe(false);
  });

  it('worker disconnect with no text is an error with the user message kept retryable', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateDisconnect();

    expect(core.getConversationHistory()).toHaveLength(0);
    const live = useStreamStore.getState().streams[42]!;
    expect(live.status).toBe('error');
    expect(live.failedUserMessage).toMatchObject({ content: 'q' });
  });
});
