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
import type { WebResult } from '@/shared/types';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { submit } from '@/panel/lib/send';
import { abortGeneration, ownsGeneration } from '@/panel/lib/stream-controller';
import { markFullscreenSurface, resetSurfaceMode } from '@/panel/lib/surface';
import { setTTSAutoPlay, isTTSPlaying, stopTTSPlayback } from '@/panel/lib/tts/player';

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
    expect(hist[1]).not.toHaveProperty('reasoning'); // no thinking streamed → no field
    expect(useStreamStore.getState().streams[42]).toBeUndefined();
    expect(core.getIsGenerating()).toBe(false);
  });

  // The thinking block used to vanish the moment the answer completed: the
  // reasoning lived only on the live stream entry, which finalize() drops.
  it('the reasoning that preceded the answer is saved with it (history + session snapshot)', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'thinking', content: '先想一下。' });
    getPort()._simulateMessage({ type: 'thinking', content: '再想一步。' });
    getPort()._simulateMessage({ type: 'chunk', content: 'answer' });
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });

    const answer = core.getConversationHistory()[1]!;
    expect(answer).toMatchObject({ role: 'assistant', content: 'answer', reasoning: '先想一下。再想一步。' });
    const saved = store.session.tabState_42 as { conversationHistory: { reasoning?: string }[] };
    expect(saved.conversationHistory.at(-1)!.reasoning).toBe('先想一下。再想一步。');
  });

  it('saved reasoning never goes back to the model', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'thinking', content: '先想一下。' });
    getPort()._simulateMessage({ type: 'chunk', content: 'answer' });
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });

    useComposerStore.getState().setDraftText('and now?');
    await submit();
    await flush();

    const sent = getPort().postMessage.mock.calls[0][0] as { messages: Record<string, unknown>[] };
    const earlier = sent.messages.find(m => m.role === 'assistant')!;
    expect(earlier.content).toBe('answer');
    // Strict providers reject reasoning in input messages: wire fields only.
    expect(Object.keys(earlier).sort()).toEqual(['content', 'role']);
  });

  it('stop AFTER partial text keeps the reasoning with the partial answer', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'thinking', content: '先想一下。' });
    getPort()._simulateMessage({ type: 'chunk', content: 'partial answer' });
    abortGeneration(42);

    expect(core.getConversationHistory()[1]).toMatchObject({ role: 'assistant', content: 'partial answer', reasoning: '先想一下。' });
  });

  it('a failed turn saves no reasoning (the turn is rolled back whole)', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'thinking', content: 'a thought that led nowhere' });
    getPort()._simulateMessage({ type: 'error', error: 'boom' });

    expect(core.getConversationHistory()).toHaveLength(0);
    const saved = store.session.tabState_42 as { conversationHistory: unknown[] };
    expect(saved.conversationHistory).toHaveLength(0);
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

  // Autoplay claims the window-global audio resource the moment the stream
  // starts. A turn that then ends WITHOUT an answer must give it back — it
  // used to stay on "reading" forever, and the next play click only cleared it.
  describe('autoplay x turn outcome', () => {
    afterEach(() => {
      setTTSAutoPlay(false);
      stopTTSPlayback();
    });

    it('a failed turn releases the playback it claimed', async () => {
      setTTSAutoPlay(true);
      useComposerStore.getState().setDraftText('q');
      await submit();
      await flush();
      expect(isTTSPlaying()).toBe(true); // claimed at stream start, before any text

      getPort()._simulateMessage({ type: 'thinking', content: '先想一下。' });
      getPort()._simulateMessage({ type: 'error', error: 'boom' });
      expect(isTTSPlaying()).toBe(false);
    });

    it('stopped during the thinking phase releases it too', async () => {
      setTTSAutoPlay(true);
      useComposerStore.getState().setDraftText('q');
      await submit();
      await flush();
      getPort()._simulateMessage({ type: 'thinking', content: '先想一下。' });

      abortGeneration(42);
      expect(isTTSPlaying()).toBe(false);
    });

    it('stopped AFTER text keeps reading the partial answer', async () => {
      setTTSAutoPlay(true);
      useComposerStore.getState().setDraftText('q');
      await submit();
      await flush();
      getPort()._simulateMessage({ type: 'chunk', content: 'partial answer' });

      abortGeneration(42);
      expect(isTTSPlaying()).toBe(true);
    });
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

  // F15 web search
  it('web search is on by default: the request asks for it', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();

    const sent = getPort().postMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ type: 'chat', webSearch: true });
  });

  it('with web search switched off the request carries no webSearch', async () => {
    store.sync.webSearch = false;
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();

    expect(getPort().postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    const sent = getPort().postMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('webSearch');
  });

  const SEARCH_STARTED = { type: 'call_started', step: 0, call: { id: 'c1', index: 0, kind: 'deep_search', action: { type: 'search', queries: ['q1'] } } } as const;
  const SEARCH_DONE = { type: 'call_completed', step: 0, call: { id: 'c1', index: 0, status: 'completed', sources: [{ url: 'https://a.test/', title: 'A', siteName: 'A' }] } } as const;

  it('web search: progress builds the live trace, and done.web is saved with the answer', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_STARTED });
    expect(useStreamStore.getState().streams[42]!.webSteps).toMatchObject([{ id: 'c1', status: 'running' }]);
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_DONE });
    getPort()._simulateMessage({ type: 'chunk', content: 'answer' });
    const web: WebResult = {
      steps: [{ id: 'c1', kind: 'deep_search', action: { type: 'search', queries: ['q1'] }, status: 'completed', sources: [{ url: 'https://a.test/', title: 'A', siteName: 'A' }] }],
      sources: [{ url: 'https://a.test/', title: 'A', siteName: 'A' }],
      citations: [{ start: 0, end: 6, source: 0 }],
      searches: 1, pages: 0,
    };
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop', web });

    const answer = core.getConversationHistory()[1]!;
    expect(answer).toMatchObject({ role: 'assistant', content: 'answer', web });
    // …and it is in the session snapshot the panel restores from (stored as
    // a structured clone, not a JSON string).
    const saved = store.session.tabState_42 as { conversationHistory: { web?: WebResult }[] };
    expect(saved.conversationHistory.at(-1)!.web).toEqual(web);
  });

  it('web search: an answer that did not search carries no web field', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'chunk', content: 'plain' });
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });

    expect(core.getConversationHistory()[1]).toMatchObject({ role: 'assistant', content: 'plain' });
    expect(core.getConversationHistory()[1]).not.toHaveProperty('web');
  });

  it('web search: stopped mid-search after some text keeps the finished calls as the trace', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_STARTED });
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_DONE });
    getPort()._simulateMessage({ type: 'search_event', event: { type: 'call_started', step: 1, call: { id: 'c2', index: 0, kind: 'deep_search', action: { type: 'open_page', url: 'https://a.test/' } } } });
    getPort()._simulateMessage({ type: 'chunk', content: 'partial' });
    abortGeneration(42);

    // The still-running call is dropped; citations never arrived, so there are none.
    expect(core.getConversationHistory()[1]!.web).toEqual({
      steps: [{ id: 'c1', kind: 'deep_search', action: { type: 'search', queries: ['q1'] }, status: 'completed', sources: [{ url: 'https://a.test/', title: 'A', siteName: 'A' }] }],
      sources: [], citations: [], searches: 1, pages: 0,
    });
  });

  it('web search: stopped before any text leaves no web record at all', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_STARTED });
    abortGeneration(42);

    expect(core.getConversationHistory()).toHaveLength(0);
  });

  it('retry: the dead attempt\'s reasoning and search events are dropped; the turn keeps generating and then completes', async () => {
    useComposerStore.getState().setDraftText('q');
    await submit();
    await flush();
    const assistantId = useStreamStore.getState().streams[42]!.assistantId;
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_STARTED });
    getPort()._simulateMessage({ type: 'thinking', content: 'half a thought' });
    getPort()._simulateMessage({ type: 'retry', attempt: 1 });

    expect(useStreamStore.getState().streams[42]).toMatchObject({ assistantId, status: 'streaming', thinking: '', answer: '', webSteps: [] });
    expect(core.getIsGenerating()).toBe(true);                       // still generating
    expect(core.getConversationHistory()).toHaveLength(1);            // the user message stays
    expect(useUIStore.getState().toasts.at(-1)?.message).toBe('连接中断，正在自动重试…');
    expect(getPort().disconnect).not.toHaveBeenCalled();

    // The retried attempt streams normally (and its `done` carries the web record).
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_STARTED });
    getPort()._simulateMessage({ type: 'search_event', event: SEARCH_DONE });
    getPort()._simulateMessage({ type: 'thinking', content: 'a fresh thought' });
    getPort()._simulateMessage({ type: 'chunk', content: 'answer' });
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop', web: { steps: [], sources: [], citations: [], searches: 1, pages: 0 } });
    const hist = core.getConversationHistory();
    expect(hist).toHaveLength(2);
    expect(hist[1]).toMatchObject({ id: assistantId, role: 'assistant', content: 'answer', web: { searches: 1 } });
    // …and only ITS reasoning is saved with it — the dead attempt's is gone.
    expect(hist[1]!.reasoning).toBe('a fresh thought');
  });
});

// --- F17: the fullscreen surface is a PURE chat (no page grounding) -------

describe('fullscreen surface pipeline (F17)', () => {
  // The outer describe's beforeEach lives INSIDE it — this one re-seeds what
  // these tests need: leftover history from the panel-pipeline tests would
  // ride into the request via trimHistory and break the shape assertions.
  const tabsSendMessage = (globalThis as unknown as { chrome: { tabs: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.tabs.sendMessage;

  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    connectMock.mockClear();
    getPort()?.postMessage.mockClear();
    tabsSendMessage.mockClear();
    // A previous test's unfinished stream leaves the tab "generating" — the
    // busy guard would swallow this describe's sends.
    if (ownsGeneration(42)) abortGeneration(42);
    useTabsStore.getState().setGeneratingForTab(42, false);
    useStreamStore.setState({ streams: {} });
    useUIStore.setState({ sheet: null, toasts: [] });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    useTabsStore.getState().setCustomSystemPrompt('');
    useTabsStore.getState().setConversationHistory([]);
    // A cached page is exactly what must NOT leak into a fullscreen request.
    useTabsStore.getState().setPageContent('cached page');
    useTabsStore.getState().setPageTitle('T');
    useTabsStore.getState().setSelectedText('');
  });

  afterEach(() => {
    resetSurfaceMode();
  });

  it('never sends the cached article: the chat persona replaces the reading persona', async () => {
    markFullscreenSurface();
    useComposerStore.getState().setDraftText('你好');
    await submit();
    await flush();

    const req = getPort().postMessage.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    // One persona system message + the user message — no article block, no
    // citation rule, none of the cached page text.
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]!.role).toBe('system');
    expect(req.messages[0]!.content).toContain('普通聊天界面');
    expect(req.messages[0]!.content).not.toContain('cached page');
    expect(req.messages[0]!.content).not.toContain('【文章内容】');
    expect(req.messages[0]!.content).not.toContain('[#N]');
    expect(req.messages.map(m => m.content).join('\n')).not.toContain('cached page');
  });

  it('the custom system prompt rides the chat persona', async () => {
    markFullscreenSurface();
    useTabsStore.getState().setCustomSystemPrompt('回答要简短');
    useComposerStore.getState().setDraftText('hi');
    await submit();
    await flush();

    const req = getPort().postMessage.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    expect(req.messages[0]!.content).toContain('回答要简短');
    useTabsStore.getState().setCustomSystemPrompt('');
  });

  it('no extraction attempt: a send with NO page cache still succeeds', async () => {
    markFullscreenSurface();
    // In the side panel this state would trigger extraction (and a send to a
    // page without a content script FAILS); fullscreen must not care.
    useTabsStore.getState().setPageContent('');
    useComposerStore.getState().setDraftText('你好');
    await submit();
    await flush();

    expect(tabsSendMessage).not.toHaveBeenCalled();
    expect(connectMock).toHaveBeenCalledWith({ name: 'ai-chat' });
    expect(core.getConversationHistory()).toHaveLength(1);
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it('a quoted selection still prefixes the message (explicit user content, not page embedding)', async () => {
    markFullscreenSurface();
    useTabsStore.getState().setSelectedText('页面上的某句话');
    useComposerStore.getState().setDraftText('怎么看');
    await submit();
    await flush();

    const msg = core.getConversationHistory()[0]!;
    expect(msg.content).toContain('页面上的某句话');
    expect(msg.meta!.quote).toBe('页面上的某句话');
  });
});
