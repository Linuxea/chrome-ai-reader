import { vi, describe, it, expect, beforeEach } from 'vitest';
import { t } from '@/shared/i18n.js';

// chrome mock BEFORE any panel/legacy import (state.ts registers tab
// lifecycle listeners at module load). Fresh programmable port per connect,
// so tests can play the SW side of the ai-chat port.
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
import { useUIStore } from '@/panel/stores/ui-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useQuizStore } from '@/panel/stores/quiz-store';
import type { QuizSession } from '@/shared/quiz';
import {
  startQuiz, stopQuiz, answerQuestion, gotoNextQuestion, retakeWrongQuestions,
  followupDraft, requestVariant, startDeck, gradeCard, drillUnknownCards,
  backToSummary, exportCsv, wrongAnswerIndexes,
} from '@/panel/lib/quiz-controller';

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** The persisted session mirror (TabState.quizSession) — throws when missing. */
function persisted(): QuizSession {
  const ts = core.getStateForTab(42);
  if (!ts || !ts.quizSession) throw new Error('expected a persisted quiz session');
  return ts.quizSession;
}

const Q1 = '{"question":"What is 2+2?","options":["3","4"],"answer":1,"explanation":"Basic math [#1]"}';
const Q2 = '{"question":"Capital of France?","options":["Lyon","Paris"],"answer":1,"explanation":"Geography"}';
const FULL_QUIZ = `{"questions":[${Q1},${Q2}],"flashcards":[{"front":"F1","back":"B1"}]}`;

/** Start a quiz and drive it to completion with the given raw text. */
async function completeQuiz(raw: string): Promise<void> {
  const p = startQuiz();
  await flush();
  getPort()._simulateMessage({ type: 'chunk', content: raw });
  getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });
  await p;
}

describe('quiz controller — generation', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    connectMock.mockClear();
    useQuizStore.setState({ sessions: {}, variantBusy: {}, flipped: {} });
    useUIStore.setState({ sheet: null, toasts: [], commandPopup: { open: false, query: '', highlighted: 0 } });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setPageContent('cached page content long enough to split into a paragraph.');
    useTabsStore.getState().setPageTitle('T');
  });

  it('sends the quiz prompt as a JSON-mode chat request on the ai-chat port', async () => {
    const p = startQuiz();
    await flush();

    expect(connectMock).toHaveBeenCalledWith({ name: 'ai-chat' });
    const req = getPort().postMessage.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.type).toBe('chat');
    expect(req.response_format).toEqual({ type: 'json_object' });
    expect(req.temperature).toBe(0.5);
    const messages = req.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('T');

    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });
    await p;
  });

  it('does not touch the tab generating flag (the chat Stop stays a chat stop)', async () => {
    await completeQuiz(FULL_QUIZ);
    expect(core.getIsGenerating()).toBe(false);
  });

  it('commits each question the moment its object closes — one question across many chunks', async () => {
    const p = startQuiz();
    await flush();

    // Q1 straddles three chunks; nothing usable until its object closes.
    getPort()._simulateMessage({ type: 'chunk', content: '{"questions": [{"question": "What ' });
    let session = core.getStateForTab(42)?.quizSession;
    expect(session?.quiz.questions).toHaveLength(0);
    expect(useQuizStore.getState().sessions[42]?.quiz.questions).toHaveLength(0);

    getPort()._simulateMessage({ type: 'chunk', content: 'is 2+2?","options":["3","4"],"ans' });
    expect(useQuizStore.getState().sessions[42]?.quiz.questions).toHaveLength(0);

    getPort()._simulateMessage({ type: 'chunk', content: 'wer":1,"explanation":"Basic math [#1]"},' });
    session = core.getStateForTab(42)?.quizSession;
    expect(session?.quiz.questions).toHaveLength(1); // persisted at the boundary
    expect(session?.answers).toEqual([null]);
    expect(session?.quiz.questions[0]).toMatchObject({ question: 'What is 2+2?', answer: 1 });
    // streaming flag still on while more may follow
    expect(session?.generating).toBe(true);

    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });
    await p;

    session = core.getStateForTab(42)?.quizSession;
    expect(session?.generating).toBe(false);
    expect(session?.error).toBeUndefined();
  });

  it('flush() replaces the stream scan with the authoritative quiz (flashcards included)', async () => {
    await completeQuiz(FULL_QUIZ);

    const session = persisted();
    expect(session.quiz.questions).toHaveLength(2);
    expect(session.quiz.flashcards).toEqual([{ front: 'F1', back: 'B1' }]);
    expect(session.answers).toEqual([null, null]);
    expect(session.phase).toBe('answering');
    expect(session.generating).toBe(false);
    // kept in the store (reactive source) too
    expect(useQuizStore.getState().sessions[42]).toBe(session);
  });

  it('a flashcards-only quiz skips straight to the summary', async () => {
    await completeQuiz('{"questions":[],"flashcards":[{"front":"F","back":"B"}]}');
    const session = persisted();
    expect(session.quiz.questions).toHaveLength(0);
    expect(session.phase).toBe('summary');
    expect(session.error).toBeUndefined();
  });

  it('an unparseable answer surfaces quiz.failed with the message', async () => {
    await completeQuiz('this is not JSON at all');
    const session = persisted();
    expect(session.error).toBe(`${t('quiz.failed')}：${t('quiz.parseFailed')}`);
    expect(session.generating).toBe(false);
  });

  it('a worker error message surfaces quiz.failed with the error text', async () => {
    const p = startQuiz();
    await flush();
    getPort()._simulateMessage({ type: 'error', error: 'boom' });
    await p;
    expect(core.getStateForTab(42)?.quizSession?.error).toBe(`${t('quiz.failed')}：boom`);
  });

  it('a mid-stream failure keeps the already-streamed questions (partialFailed)', async () => {
    const p = startQuiz();
    await flush();
    getPort()._simulateMessage({ type: 'chunk', content: `{"questions":[${Q1},` });
    getPort()._simulateMessage({ type: 'error', error: 'boom' });
    await p;

    const session = persisted();
    expect(session.quiz.questions).toHaveLength(1);
    expect(session.error).toBe(t('quiz.partialFailed', { count: '1' }));
    expect(session.generating).toBe(false);
  });

  it('is rejected while a chat answer is generating', async () => {
    useTabsStore.getState().setGeneratingForTab(42, true);
    await startQuiz();
    await flush();
    expect(connectMock).not.toHaveBeenCalled();
    expect(useQuizStore.getState().sessions[42]).toBeUndefined();
  });

  it('is rejected while a quiz generation is already in flight', async () => {
    const p = startQuiz();
    await flush();
    await startQuiz(); // second start must be a no-op
    expect(connectMock).toHaveBeenCalledTimes(1);
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });
    await p;
  });
});

describe('quiz controller — stop', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    connectMock.mockClear();
    useQuizStore.setState({ sessions: {}, variantBusy: {}, flipped: {} });
    useUIStore.setState({ sheet: null, toasts: [], commandPopup: { open: false, query: '', highlighted: 0 } });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setPageContent('cached page content long enough to split into a paragraph.');
  });

  it('mid-stream stop keeps the streamed questions as a partial', async () => {
    const p = startQuiz();
    await flush();
    getPort()._simulateMessage({ type: 'chunk', content: `{"questions":[${Q1},` });

    stopQuiz();
    await p;

    expect(getPort().disconnect).toHaveBeenCalled();
    const session = persisted();
    expect(session.quiz.questions).toHaveLength(1);
    expect(session.error).toBe(t('quiz.partialFailed', { count: '1' }));
    expect(session.generating).toBe(false);
  });

  it('stop before anything arrived cancels the card entirely', async () => {
    const p = startQuiz();
    await flush();

    stopQuiz();
    await p;

    expect(useQuizStore.getState().sessions[42]).toBeUndefined();
    expect(core.getStateForTab(42)?.quizSession).toBeUndefined();
    expect(useUIStore.getState().toasts.some(x => x.message === t('ai.stopped'))).toBe(true);
  });

  it('stop during page extraction is consumed before the port opens', async () => {
    const p = startQuiz();
    stopQuiz(); // synchronously after start: extraction has not resolved yet
    await p;

    expect(connectMock).not.toHaveBeenCalled();
    expect(useQuizStore.getState().sessions[42]).toBeUndefined();
    expect(useUIStore.getState().toasts.some(x => x.message === t('ai.stopped'))).toBe(true);
  });
});

describe('quiz controller — answering & summary transitions', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    connectMock.mockClear();
    useQuizStore.setState({ sessions: {}, variantBusy: {}, flipped: {} });
    useUIStore.setState({ sheet: null, toasts: [], commandPopup: { open: false, query: '', highlighted: 0 } });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setPageContent('cached page content long enough to split into a paragraph.');
    await completeQuiz(FULL_QUIZ);
  });

  it('answering records the choice and persists immediately; re-answer is ignored', () => {
    answerQuestion(42, 0, 1); // correct
    let session = persisted();
    expect(session.answers[0]).toBe(1);

    answerQuestion(42, 0, 0); // already answered — ignored
    session = persisted();
    expect(session.answers[0]).toBe(1);
    expect(wrongAnswerIndexes(session)).toEqual([]);
  });

  it('next advances the current question, then finishes into the summary', () => {
    answerQuestion(42, 0, 1);
    gotoNextQuestion(42);
    expect(core.getStateForTab(42)?.quizSession?.current).toBe(1);

    answerQuestion(42, 1, 0); // wrong this time
    gotoNextQuestion(42); // last question → summary
    const session = persisted();
    expect(session.phase).toBe('summary');
    expect(wrongAnswerIndexes(session)).toEqual([1]);
  });

  it('retakeWrongQuestions re-drills only the wrong ones with fresh answers', () => {
    answerQuestion(42, 0, 1); // correct
    answerQuestion(42, 1, 0); // wrong
    gotoNextQuestion(42);
    retakeWrongQuestions(42);

    const session = persisted();
    expect(session.phase).toBe('answering');
    expect(session.quiz.questions).toHaveLength(1);
    expect(session.quiz.questions[0]!.question).toBe('Capital of France?');
    expect(session.answers).toEqual([null]);
    expect(session.current).toBe(0);
    // The original full quiz survives in storage history only as this replacement:
    expect(session.quiz.flashcards).toEqual([{ front: 'F1', back: 'B1' }]);
  });

  it('followupDraft pre-fills the composer with the question context', () => {
    answerQuestion(42, 0, 0); // wrong on purpose
    followupDraft(42, 0);
    const draft = useComposerStore.getState().draftText;
    expect(draft).toContain('What is 2+2?');
    expect(draft).toContain('A. 3');
    expect(draft).toContain('B. 4');
    expect(draft).toContain('Basic math [#1]');
  });

  it('exportCsv downloads the Anki CSV and toasts', () => {
    const createObjectURL = vi.fn(() => 'blob:quiz');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    exportCsv(42);

    expect(createObjectURL).toHaveBeenCalled();
    expect(useUIStore.getState().toasts.some(x => x.message === t('quiz.exported'))).toBe(true);
  });
});

describe('quiz controller — variant question', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    connectMock.mockClear();
    useQuizStore.setState({ sessions: {}, variantBusy: {}, flipped: {} });
    useUIStore.setState({ sheet: null, toasts: [], commandPopup: { open: false, query: '', highlighted: 0 } });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setPageContent('cached page content long enough to split into a paragraph.');
    await completeQuiz(FULL_QUIZ);
  });

  it('appends the variant question and jumps to it when asked from the summary', async () => {
    answerQuestion(42, 0, 1);
    gotoNextQuestion(42);
    answerQuestion(42, 1, 0);
    gotoNextQuestion(42); // summary
    expect(core.getStateForTab(42)?.quizSession?.phase).toBe('summary');

    const p = requestVariant(42, 1);
    await flush();
    getPort()._simulateMessage({ type: 'chunk', content: '{"question":{"question":"Variant?","options":["x","y"],"answer":0,"explanation":"ve"}}' });
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });
    await p;

    const session = persisted();
    expect(session.quiz.questions).toHaveLength(3);
    expect(session.quiz.questions[2]!.question).toBe('Variant?');
    expect(session.answers[2]).toBeNull();
    expect(session.phase).toBe('answering'); // jumped straight to the new question
    expect(session.current).toBe(2);
  });

  it('a malformed variant answer toasts the failure and leaves the session intact', async () => {
    const before = core.getStateForTab(42)?.quizSession;
    const p = requestVariant(42, 0);
    await flush();
    getPort()._simulateMessage({ type: 'chunk', content: 'garbage' });
    getPort()._simulateMessage({ type: 'done', finishReason: 'stop' });
    await p;

    expect(core.getStateForTab(42)?.quizSession).toBe(before); // untouched
    expect(useUIStore.getState().toasts.some(x => x.message === t('quiz.variantFailed'))).toBe(true);
    expect(useQuizStore.getState().variantBusy[42]).toBe(false); // busy flag released
  });
});

describe('quiz controller — deck', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    connectMock.mockClear();
    useQuizStore.setState({ sessions: {}, variantBusy: {}, flipped: {} });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setPageContent('cached page content long enough to split into a paragraph.');
    await completeQuiz('{"questions":[],"flashcards":[{"front":"F1","back":"B1"},{"front":"F2","back":"B2"}]}');
  });

  it('startDeck walks the full deck; grading advances and persists', () => {
    startDeck(42);
    let session = persisted();
    expect(session.phase).toBe('deck');
    expect(session.deck.order).toEqual([0, 1]);

    gradeCard(42, true);
    session = persisted();
    expect(session.deck.index).toBe(1);
    expect(session.deck.known[0]).toBe(true);

    gradeCard(42, false);
    session = persisted();
    expect(session.deck.index).toBe(2); // run finished
    expect(session.deck.known[1]).toBe(false);
  });

  it('drillUnknownCards re-runs only the unknown cards, reset to unrated', () => {
    startDeck(42);
    gradeCard(42, true);
    gradeCard(42, false);

    drillUnknownCards(42);
    const session = persisted();
    expect(session.deck.index).toBe(0);
    expect(session.deck.order).toEqual([1]);
    expect(session.deck.known).toEqual([true, null]);
  });

  it('backToSummary returns to the results', () => {
    startDeck(42);
    backToSummary(42);
    expect(core.getStateForTab(42)?.quizSession?.phase).toBe('summary');
  });
});
