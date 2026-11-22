import { vi, describe, it, expect, beforeEach } from 'vitest';

const { store, connectMock, suggestPort } = vi.hoisted(() => {
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
  const suggestListeners = { onMessage: new Set<unknown>(), onDisconnect: new Set<unknown>() };
  const suggestPort = {
    name: 'suggest-questions',
    postMessage: vi.fn(),
    onMessage: { addListener: vi.fn((fn: unknown) => suggestListeners.onMessage.add(fn)), removeListener: vi.fn() },
    onDisconnect: { addListener: vi.fn((fn: unknown) => suggestListeners.onDisconnect.add(fn)), removeListener: vi.fn() },
    disconnect: vi.fn(),
    _say: (msg: unknown) => suggestListeners.onMessage.forEach(fn => (fn as (m: unknown) => void)(msg)),
  };
  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      get: vi.fn(() => Promise.resolve({ id: 42, url: 'https://page.example/article' })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect: vi.fn((info?: { name?: string }) => (info?.name === 'suggest-questions' ? suggestPort : {
        name: info?.name ?? '',
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: vi.fn(async (msg: { action?: string }) => {
        if (msg?.action === 'highlights:list') return { success: true, highlights: [] };
        if (msg?.action === 'highlights:all') return { success: true, highlights: [] };
        return { success: true };
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store, connectMock: chrome.runtime.connect, suggestPort };
});
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useSuggestStore, generateSuggestionsFor, removeSuggestions, stripListMarker, fillDraftWith } from '@/panel/lib/suggest';
import { useComposerStore } from '@/panel/stores/composer-store';
import { displayMessagesFromHistory, generateTitle } from '@/panel/lib/chat-save';
import { annotationFor, onAnnotationClick, initAnnotation, useAnnotationStore } from '@/panel/lib/annotation';
import { jumpToParagraph } from '@/panel/lib/citations';

describe('suggest chips', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    useSuggestStore.setState({ byTab: {} });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    suggestPort.postMessage.mockClear();
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
  });

  it('stripListMarker drops list markers but keeps content numbers', () => {
    expect(stripListMarker('1. 为什么')).toBe('为什么');
    expect(stripListMarker('2、怎么样')).toBe('怎么样');
    expect(stripListMarker('- * dash')).toBe('* dash');
    expect(stripListMarker('2024年发生了什么？')).toBe('2024年发生了什么？');
  });

  it('generateSuggestionsFor posts to the suggest port and lands chips', async () => {
    useTabsStore.getState().appendMessage({ id: 'u1', role: 'user', content: '解释量子纠缠' });
    useTabsStore.getState().appendMessage({ id: 'a1', role: 'assistant', content: '……长回答……' });
    generateSuggestionsFor(42);
    expect(useSuggestStore.getState().byTab[42]?.loading).toBe(true);
    expect(suggestPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'suggest' }));

    suggestPort._say({ type: 'chunk', content: '1. 第一问\n' });
    suggestPort._say({ type: 'chunk', content: '2. 第二问\n2024年的事？' });
    suggestPort._say({ type: 'done' });

    const entry = useSuggestStore.getState().byTab[42];
    expect(entry?.loading).toBe(false);
    expect(entry?.questions).toEqual(['第一问', '第二问', '2024年的事？']);
  });

  it('a chip click fills the draft without clobbering it', () => {
    useComposerStore.getState().setDraftText('已有草稿');
    fillDraftWith('追问问题');
    expect(useComposerStore.getState().draftText).toBe('已有草稿\n追问问题');
  });

  it('removeSuggestions drops the entry', () => {
    useSuggestStore.setState({ byTab: { 42: { loading: false, questions: ['q'] } } });
    removeSuggestions(42);
    expect(useSuggestStore.getState().byTab[42]).toBeUndefined();
  });
});

describe('chat save derivation', () => {
  it('displayMessagesFromHistory derives display text + quote + md format from data', () => {
    const out = displayMessagesFromHistory([
      { role: 'system', content: 'sys' },
      { id: 'u1', role: 'user', content: 'API 内容', meta: { rawText: 'API 内容', displayText: '显示内容', quote: '引文' } },
      { id: 'a1', role: 'assistant', content: '# 答' },
      { id: 'u2', role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:x' } }], hadImages: true, meta: { rawText: '', displayText: '' } },
    ]);
    expect(out).toEqual([
      { role: 'user', content: '显示内容', quote: '引文' },
      { role: 'assistant', content: '# 答', format: 'md' },
      { role: 'user', content: expect.stringContaining('') }, // image-only placeholder
    ]);
    expect(out[2]!.content).toBeTruthy();
  });

  it('generateTitle uses the first user message (30 chars + ellipsis)', () => {
    expect(generateTitle([{ role: 'user', content: '短问题' }])).toBe('短问题');
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十';
    expect(generateTitle([{ role: 'user', content: long }])).toBe(`${long.slice(0, 30)}...`);
  });
});

describe('annotation state machine', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    useAnnotationStore.setState({ byTab: {} });
    initAnnotation();
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
  });

  it('idle click starts annotation; content-script failure lands in error', async () => {
    const tabs = chrome.tabs as { sendMessage: ReturnType<typeof vi.fn> };
    tabs.sendMessage.mockResolvedValueOnce({ success: true });
    await onAnnotationClick();
    expect(annotationFor(42)).toMatchObject({ kind: 'annotating', done: 0, total: 0 });

    // done → second click clears back to idle
    useAnnotationStore.getState()._set(42, { kind: 'done', count: 5, failed: 0 });
    tabs.sendMessage.mockResolvedValueOnce({ success: true });
    await onAnnotationClick();
    expect(annotationFor(42)).toMatchObject({ kind: 'idle' });
  });

  it('start failure on an unsupported page ends in error, not stuck annotating', async () => {
    const tabs = chrome.tabs as { sendMessage: ReturnType<typeof vi.fn> };
    tabs.sendMessage.mockRejectedValueOnce(new Error('no host'));
    await onAnnotationClick();
    expect(annotationFor(42)).toMatchObject({ kind: 'error' });
  });
});

describe('citations', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
  });

  it('jumpToParagraph shows unavailable when the paragraph is missing', async () => {
    await expect(jumpToParagraph(3)).resolves.toBe(false);
  });

  it('jumpToParagraph asks the content script to highlight the paragraph', async () => {
    useTabsStore.getState().setPageContent('cached');
    core.getStateForTab(42)!.pageParagraphs = ['第一段', '第二段内容'];
    const tabs = chrome.tabs as { sendMessage: ReturnType<typeof vi.fn> };
    tabs.sendMessage.mockResolvedValueOnce({ ok: true });
    await expect(jumpToParagraph(1)).resolves.toBe(true);
    expect(tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'highlightParagraph', text: '第二段内容' });
  });
});
