import { vi, describe, it, expect, beforeEach } from 'vitest';

// chrome must be on globalThis BEFORE the panel tabs-store (→ legacy
// state.ts) is imported: state.ts registers tab lifecycle listeners at
// module load when chrome.tabs exists. Same pattern as state.test.js.
const { store } = vi.hoisted(() => {
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

  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store };
});

import * as core from '@/panel/state';
import { useTabsStore, useActiveTabState } from '@/panel/stores/tabs-store';
import { renderHook } from '@testing-library/react';
import type { ChatMessage } from '@/shared/types';

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ id: `m_${content}`, role, content }) as ChatMessage;

describe('tabs-store (wrapper over legacy state core)', () => {
  beforeEach(async () => {
    // Fresh core + fresh session storage: initState restores whatever a
    // previous test persisted into tabState_42, so wipe it first.
    store.session = {};
    store.sync = {};
    store.local = {};
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
  });

  it('init mirrors the active tab from chrome.tabs.query', () => {
    const s = useTabsStore.getState();
    expect(s.activeTabId).toBe(42);
    expect(s.version).toBeGreaterThan(0);
  });

  it('appendMessage pushes into the core conversation and bumps version', () => {
    const before = useTabsStore.getState().version;
    useTabsStore.getState().appendMessage(msg('user', 'hello'));
    expect(core.getConversationHistory().map(m => m.content)).toEqual(['hello']);
    expect(useTabsStore.getState().version).toBe(before + 1);
  });

  it('rollbackTrailingUserMessage removes a trailing user turn and bumps', () => {
    useTabsStore.getState().appendMessage(msg('user', 'q1'));
    const before = useTabsStore.getState().version;
    expect(useTabsStore.getState().rollbackTrailingUserMessage()).toBe(true);
    expect(core.getConversationHistory()).toHaveLength(0);
    expect(useTabsStore.getState().version).toBe(before + 1);
  });

  it('setGeneratingForTab mirrors the flag for the active tab', () => {
    useTabsStore.getState().setGeneratingForTab(42, true);
    expect(useTabsStore.getState().isGenerating).toBe(true);
    useTabsStore.getState().setGeneratingForTab(42, false);
    expect(useTabsStore.getState().isGenerating).toBe(false);
  });

  it('core-native notifications are bridged (isGenerating mirror)', () => {
    // A stream finishing via core code (not through the store wrapper).
    core.setGeneratingForTab(42, true);
    expect(useTabsStore.getState().isGenerating).toBe(true);
    core.setGeneratingForTab(42, false);
    expect(useTabsStore.getState().isGenerating).toBe(false);
  });

  it('switchToTab mirrors the new active tab and bumps version', async () => {
    store.session['tabState_7'] = {
      pageContent: 'cached',
      conversationHistory: [msg('user', 'from-tab-7')],
    };
    const before = useTabsStore.getState().version;
    await useTabsStore.getState().switchToTab(7);
    const s = useTabsStore.getState();
    expect(s.activeTabId).toBe(7);
    expect(s.version).toBeGreaterThan(before);
    expect(core.getConversationHistory().map(m => m.content)).toEqual(['from-tab-7']);
  });

  it('branchFromId parks the continuation and switchBranch restores it', () => {
    useTabsStore.getState().appendMessage(msg('user', 'u1'));
    useTabsStore.getState().appendMessage(msg('assistant', 'a1'));
    useTabsStore.getState().appendMessage(msg('user', 'u2'));
    useTabsStore.getState().appendMessage(msg('assistant', 'a2'));

    // Retry the second user turn → its continuation becomes a branch.
    const u2 = core.getConversationHistory()[2];
    expect(useTabsStore.getState().branchFromId(u2.id!)).toBe(2);
    expect(core.getConversationHistory().map(m => m.content)).toEqual(['u1', 'a1']);

    // Switch back to branch 1 — 'u2','a2' return.
    expect(useTabsStore.getState().switchBranch('m_a1', 0)).toBe(true);
    expect(core.getConversationHistory().map(m => m.content)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('field setters delegate to the core and bump (selectedText drives the quote bar)', () => {
    const before = useTabsStore.getState().version;
    useTabsStore.getState().setSelectedText('highlighted passage');
    expect(core.getSelectedText()).toBe('highlighted passage');
    expect(useTabsStore.getState().version).toBe(before + 1);
  });

  it('restored state never comes back with in-flight flags', async () => {
    store.session['tabState_9'] = { isGenerating: true, isPodcastGenerating: true, conversationHistory: [] };
    await useTabsStore.getState().switchToTab(9);
    expect(useTabsStore.getState().isGenerating).toBe(false);
    expect(core.getStateForTab(9)!.isGenerating).toBe(false);
  });
});

describe('useActiveTabState hook', () => {
  it('returns the live TabState object of the active tab', async () => {
    const { result } = renderHook(() => useActiveTabState());
    expect(result.current?.pageContent ?? '').toBe('');
  });
});
