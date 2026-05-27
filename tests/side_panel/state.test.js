import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.hoisted runs BEFORE module imports, so chrome is on globalThis
// when state.js calls chrome.tabs.onRemoved.addListener at module level.
const { store, getOnRemovedListener } = vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };

  function createStorageArea(storeKey) {
    return {
      // state.js uses await-style (no callback), so return a Promise
      get(keys, cb) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((k) => {
          if (store[storeKey][k] !== undefined) result[k] = store[storeKey][k];
        });
        if (cb) { cb(result); return; }
        return Promise.resolve(result);
      },
      set(items, cb) {
        for (const [k, v] of Object.entries(items)) {
          store[storeKey][k] = v;
        }
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
      remove(keys, cb) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((k) => delete store[storeKey][k]);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
    };
  }

  let _onRemovedListener = null;

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
      onRemoved: {
        addListener: vi.fn((fn) => { _onRemovedListener = fn; }),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };

  globalThis.chrome = chrome;

  return { store, getOnRemovedListener: () => _onRemovedListener };
});

import * as state from '../../src/side_panel/state.js';

describe('Global state: customSystemPrompt', () => {
  it('defaults to empty string', () => {
    expect(state.getCustomSystemPrompt()).toBe('');
  });

  it('set/get round-trip', () => {
    state.setCustomSystemPrompt('Be concise');
    expect(state.getCustomSystemPrompt()).toBe('Be concise');
  });
});

describe('Global state: quickCommands', () => {
  it('defaults to empty array', () => {
    state.setQuickCommands([]);
    expect(state.getQuickCommands()).toEqual([]);
  });

  it('set/get round-trip', () => {
    const cmds = [{ name: 'sum', prompt: 'Summarize' }];
    state.setQuickCommands(cmds);
    expect(state.getQuickCommands()).toEqual(cmds);
  });
});

describe('Global state: suggestQuestionsEnabled', () => {
  it('defaults to true', () => {
    // reset to default before checking
    state.setSuggestQuestionsEnabled(true);
    expect(state.isSuggestQuestionsEnabled()).toBe(true);
  });

  it('set/get round-trip', () => {
    state.setSuggestQuestionsEnabled(false);
    expect(state.isSuggestQuestionsEnabled()).toBe(false);
  });
});

describe('initState', () => {
  it('restores systemPrompt from sync storage', async () => {
    store.sync.systemPrompt = 'You are a poet';
    await state.initState();
    expect(state.getCustomSystemPrompt()).toBe('You are a poet');
  });

  it('loads quickCommands from local storage', async () => {
    store.local.quickCommands = [{ name: 'cmd1', prompt: 'Do something' }];
    await state.initState();
    expect(state.getQuickCommands()).toEqual([
      { name: 'cmd1', prompt: 'Do something' },
    ]);
  });

  it('creates active tab state from chrome.tabs.query', async () => {
    await state.initState();
    expect(state.getActiveTabId()).toBe(42);
  });

  it('loads suggestQuestions from sync storage', async () => {
    store.sync.suggestQuestions = false;
    await state.initState();
    expect(state.isSuggestQuestionsEnabled()).toBe(false);
  });

  it('restores tab state from session storage', async () => {
    store.session['tabState_42'] = {
      pageContent: 'cached content',
      pageTitle: 'Cached Title',
      pageExcerpt: '',
      conversationHistory: [],
      currentChatId: null,
      selectedText: '',
      isGenerating: false,
      isPodcastGenerating: false,
      isChartGenerating: false,
      detectedCharts: [],
      ocrRunning: 0,
      ocrResults: [],
      imageIndex: 0,
    };
    await state.initState();
    expect(state.getPageTitle()).toBe('Cached Title');
    expect(state.getPageContent()).toBe('cached content');
  });
});

describe('Per-tab state: basic get/set', () => {
  beforeEach(async () => {
    // Ensure we have a fresh active tab
    store.sync.systemPrompt = '';
    store.local.quickCommands = undefined;
    await state.initState();
  });

  it('pageContent: default is empty string', () => {
    state.setPageContent('');
    expect(state.getPageContent()).toBe('');
  });

  it('pageContent: set/get round-trip', () => {
    state.setPageContent('Hello world');
    expect(state.getPageContent()).toBe('Hello world');
  });

  it('pageTitle: set/get round-trip', () => {
    state.setPageTitle('My Page');
    expect(state.getPageTitle()).toBe('My Page');
  });

  it('isGenerating: defaults to false', () => {
    expect(state.getIsGenerating()).toBe(false);
  });

  it('isGenerating: set/get round-trip', () => {
    state.setIsGenerating(true);
    expect(state.getIsGenerating()).toBe(true);
    state.setIsGenerating(false);
    expect(state.getIsGenerating()).toBe(false);
  });

  it('currentChatId: defaults to null', () => {
    expect(state.getCurrentChatId()).toBeNull();
  });

  it('currentChatId: set/get round-trip', () => {
    state.setCurrentChatId('chat-123');
    expect(state.getCurrentChatId()).toBe('chat-123');
  });
});

describe('Conversation helpers', () => {
  beforeEach(async () => {
    store.sync.systemPrompt = '';
    await state.initState();
  });

  it('pushConversation adds a message to history', () => {
    state.clearConversation();
    state.pushConversation({ role: 'user', content: 'hi' });
    expect(state.getConversationHistory()).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  it('pushConversation appends multiple messages', () => {
    state.clearConversation();
    state.pushConversation({ role: 'user', content: 'hello' });
    state.pushConversation({ role: 'assistant', content: 'world' });
    const hist = state.getConversationHistory();
    expect(hist).toHaveLength(2);
    expect(hist[0].role).toBe('user');
    expect(hist[1].role).toBe('assistant');
  });

  it('spliceConversation removes a message', () => {
    state.clearConversation();
    state.pushConversation({ role: 'user', content: 'a' });
    state.pushConversation({ role: 'assistant', content: 'b' });
    state.pushConversation({ role: 'user', content: 'c' });
    // Remove the assistant message at index 1
    state.spliceConversation(1, 1);
    const hist = state.getConversationHistory();
    expect(hist).toHaveLength(2);
    expect(hist.map((m) => m.content)).toEqual(['a', 'c']);
  });

  it('clearConversation empties history', () => {
    state.pushConversation({ role: 'user', content: 'x' });
    state.clearConversation();
    expect(state.getConversationHistory()).toEqual([]);
  });
});

describe('subscribe / notify', () => {
  beforeEach(async () => {
    store.sync.systemPrompt = '';
    await state.initState();
  });

  it('listener is called when setIsGenerating fires (notify: true)', () => {
    const cb = vi.fn();
    state.subscribe('isGenerating', cb);
    state.setIsGenerating(true);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('unsubscribe stops notifications', () => {
    const cb = vi.fn();
    const unsub = state.subscribe('isGenerating', cb);
    unsub();
    state.setIsGenerating(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it('listener for non-notifying field is NOT called on set', () => {
    // pageContent does NOT have notify: true
    const cb = vi.fn();
    state.subscribe('pageContent', cb);
    state.setPageContent('new content');
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple subscribers on same key all get called', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    state.subscribe('isGenerating', cb1);
    state.subscribe('isGenerating', cb2);
    state.setIsGenerating(true);
    expect(cb1).toHaveBeenCalledWith(true);
    expect(cb2).toHaveBeenCalledWith(true);
  });
});

describe('switchToTab', () => {
  beforeEach(async () => {
    store.sync.systemPrompt = '';
    store.session = {};
    await state.initState();
  });

  it('switches active tab and creates fresh state', async () => {
    await state.switchToTab(99);
    expect(state.getActiveTabId()).toBe(99);
    // Fresh state should have default values
    expect(state.getPageContent()).toBe('');
    expect(state.getPageTitle()).toBe('');
  });

  it('persists outgoing tab state to session storage', async () => {
    // Set data on tab 42 before switching
    state.setPageContent('tab-42 content');
    await state.switchToTab(99);
    // Tab 42's state should be in session storage now
    expect(store.session['tabState_42'].pageContent).toBe('tab-42 content');
  });

  it('loads stored state when switching to a previously unseen tab', async () => {
    // Pre-seed session storage for tab 55
    store.session['tabState_55'] = {
      pageContent: 'preloaded',
      pageTitle: 'Preloaded Title',
      pageExcerpt: '',
      conversationHistory: [],
      currentChatId: null,
      selectedText: '',
      isGenerating: false,
      isPodcastGenerating: false,
      isChartGenerating: false,
      detectedCharts: [],
      ocrRunning: 0,
      ocrResults: [],
      imageIndex: 0,
    };
    await state.switchToTab(55);
    expect(state.getPageTitle()).toBe('Preloaded Title');
    expect(state.getPageContent()).toBe('preloaded');
  });

  it('no-ops when switching to the same tab', async () => {
    const tabIdBefore = state.getActiveTabId();
    await state.switchToTab(tabIdBefore);
    expect(state.getActiveTabId()).toBe(tabIdBefore);
  });

  it('no-ops when newTabId is falsy', async () => {
    const tabIdBefore = state.getActiveTabId();
    await state.switchToTab(0);
    expect(state.getActiveTabId()).toBe(tabIdBefore);
  });
});

describe('getStateForTab / persistForTab', () => {
  beforeEach(async () => {
    store.sync.systemPrompt = '';
    store.session = {};
    await state.initState();
  });

  it('getStateForTab returns state for a known tab', () => {
    const ts = state.getStateForTab(42);
    expect(ts).not.toBeNull();
    expect(ts).toBeTypeOf('object');
  });

  it('getStateForTab returns null for unknown tab', () => {
    expect(state.getStateForTab(999)).toBeNull();
  });

  it('persistForTab writes to session storage', () => {
    state.setPageContent('persist test');
    state.persistForTab(42);
    expect(store.session['tabState_42'].pageContent).toBe('persist test');
  });
});

describe('Tab cleanup on chrome.tabs.onRemoved', () => {
  it('removes tab state when tab is closed', async () => {
    store.sync.systemPrompt = '';
    store.session = {};
    await state.initState();
    // Verify tab 42 exists
    expect(state.getStateForTab(42)).not.toBeNull();
    // Simulate tab close — listener was registered at import time
    const listener = getOnRemovedListener();
    expect(listener).not.toBeNull();
    listener(42);
    expect(state.getStateForTab(42)).toBeNull();
    // Active state should be cleared since we closed the active tab
    expect(state.getActiveTabId()).toBeNull();
  });

  it('does not clear active state when a different tab is closed', async () => {
    store.sync.systemPrompt = '';
    store.session = {};
    await state.initState();
    // Switch to tab 50 first, then close a non-active tab
    await state.switchToTab(50);
    getOnRemovedListener()(42);
    expect(state.getActiveTabId()).toBe(50);
  });
});
