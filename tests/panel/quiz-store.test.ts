import { vi, describe, it, expect, beforeEach } from 'vitest';

// chrome mock BEFORE any panel/legacy import (state.ts registers tab
// lifecycle listeners at module load).
const { store } = vi.hoisted(() => {
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

import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useQuizStore } from '@/panel/stores/quiz-store';
import type { QuizSession } from '@/shared/quiz';

function answeredSession(): QuizSession {
  return {
    quiz: {
      questions: [{ question: 'Q1', options: ['a', 'b'], answer: 1, explanation: 'because' }],
      flashcards: [{ front: 'F', back: 'B' }],
    },
    answers: [1],
    current: 0,
    phase: 'answering',
    deck: { index: 0, order: [], known: [] },
    generating: false,
  };
}

describe('quiz store', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    useQuizStore.setState({ sessions: {}, variantBusy: {}, flipped: {} });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
  });

  it('begin() creates a generating session and persists it to TabState', () => {
    const session = useQuizStore.getState().begin(42);

    expect(session.generating).toBe(true);
    expect(session.phase).toBe('answering');
    expect(session.quiz.questions).toHaveLength(0);
    expect(useQuizStore.getState().sessions[42]).toBe(session);
    // Persisted mirror — immediately, not debounced.
    expect(core.getStateForTab(42)?.quizSession).toBe(session);
    // And flushed to chrome.storage.session (immediate persist on boundaries).
    expect(store.session[`tabState_42`]).toBeTruthy();
  });

  it('commit() replaces the session immutably and persists each boundary', () => {
    useQuizStore.getState().begin(42);
    const first = useQuizStore.getState().sessions[42]!;

    const next: QuizSession = { ...first, answers: [0], generating: false };
    useQuizStore.getState().commit(42, next);

    expect(useQuizStore.getState().sessions[42]).toBe(next);
    expect(useQuizStore.getState().sessions[42]).not.toBe(first);
    expect(core.getStateForTab(42)?.quizSession).toBe(next);
  });

  it('adopt() restores the persisted session with generating stripped', () => {
    // A panel reopen: TabState holds the quiz, the store is empty.
    core.setQuizSessionForTab(42, { ...answeredSession(), generating: true });

    const adopted = useQuizStore.getState().adopt(42);

    expect(adopted).not.toBeNull();
    expect(adopted!.quiz.questions).toHaveLength(1);
    expect(adopted!.generating).toBe(false); // a stream never survives a reopen
    expect(useQuizStore.getState().sessions[42]).toBe(adopted);
  });

  it('adopt() keeps the live entry when one exists (no clobber)', () => {
    const live = useQuizStore.getState().begin(42);
    expect(useQuizStore.getState().adopt(42)).toBe(live);
  });

  it('adopt() returns null when neither store nor TabState has a session', () => {
    expect(useQuizStore.getState().adopt(42)).toBeNull();
    expect(useQuizStore.getState().sessions[42]).toBeUndefined();
  });

  it('discard() drops the entry from the store AND from TabState', () => {
    useQuizStore.getState().begin(42);
    useQuizStore.getState().setFlipped(42, true);

    useQuizStore.getState().discard(42);

    expect(useQuizStore.getState().sessions[42]).toBeUndefined();
    expect(core.getStateForTab(42)?.quizSession).toBeUndefined();
  });

  it('variantBusy / flipped are plain per-tab transient state', () => {
    useQuizStore.getState().setVariantBusy(42, true);
    useQuizStore.getState().setFlipped(7, true);

    expect(useQuizStore.getState().variantBusy[42]).toBe(true);
    expect(useQuizStore.getState().flipped[7]).toBe(true);
    // never persisted
    expect(core.getStateForTab(42)?.quizSession).toBeUndefined();
  });
});
