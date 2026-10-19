import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string, p?: Record<string, string>) => `[${k}]${p ? JSON.stringify(p) : ''}`, getCurrentLang: () => 'zh' }));
vi.mock('../../../src/shared/download.js', () => ({ downloadFile: vi.fn() }));
vi.mock('../../../src/side_panel/ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({ smartScrollToBottom: vi.fn() }));
vi.mock('../../../src/side_panel/ui/citations.js', () => ({ linkifyCitations: vi.fn() }));
vi.mock('../../../src/side_panel/services/composer.js', () => ({ setDraftText: vi.fn() }));
vi.mock('../../../src/side_panel/services/page-extractor.js', () => ({ ensurePageContent: vi.fn(async () => ({ ok: true, value: null })) }));
vi.mock('../../../src/side_panel/events', () => ({ on: vi.fn(() => () => {}), EVENTS: { QUIZ_REBUILD_REQUEST: 'quizRebuildRequest' } }));

// Minimal per-tab TabState store. setQuizSessionForTab MERGES (like the real
// state module) so page fields survive, and keeps the same session object by
// reference for the feature's identity checks.
const tabs = vi.hoisted(() => new Map<number, Record<string, unknown>>());
vi.mock('../../../src/side_panel/state', () => ({
  getActiveTabId: () => 1,
  getStateForTab: (id: number) => tabs.get(id),
  setQuizSessionForTab: (id: number, v: unknown | null) => {
    const ts = tabs.get(id) ?? {};
    if (v) ts.quizSession = v; else delete ts.quizSession;
    tabs.set(id, ts);
  },
}));

// Scripted port: postMessage replays `scripted.chunks` then `done` on a microtask.
const scripted = vi.hoisted(() => ({ chunks: [] as string[] }));
vi.mock('../../../src/platform/ports', () => ({
  openAIChatPort: () => {
    const listeners: ((m: unknown) => void)[] = [];
    return {
      onMessage: { addListener: (fn: (m: unknown) => void) => { listeners.push(fn); } },
      onDisconnect: { addListener: () => {} },
      disconnect: () => {},
      postMessage: () => {
        queueMicrotask(() => {
          for (const c of scripted.chunks) listeners.forEach((fn) => fn({ type: 'chunk', content: c }));
          listeners.forEach((fn) => fn({ type: 'done' }));
        });
      },
    };
  },
}));

import { initQuiz, mountQuiz, startQuiz } from '../../../src/side_panel/features/quiz';
import { setDraftText } from '../../../src/side_panel/services/composer';
import { downloadFile } from '../../../src/shared/download';
import type { QuizSession } from '../../../src/shared/quiz';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));
const btn = (root: ParentNode, label: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

const makeSession = (): QuizSession => ({
  quiz: {
    questions: [
      { question: 'Q1', options: ['a', 'b'], answer: 1, explanation: 'why', paragraph: 2 },
      { question: 'Q2', options: ['c', 'd'], answer: 0, explanation: 'because' },
    ],
    flashcards: [{ front: 'F', back: 'B' }, { front: 'F2', back: 'B2' }],
  },
  answers: [null, null],
  current: 0,
  phase: 'answering',
  deck: { index: 0, order: [], known: [] },
});

/** Mount a card for `session`, registering the session as tab 1's state first. */
const mount = (session: QuizSession): HTMLElement => {
  tabs.set(1, { quizSession: session });
  mountQuiz(session);
  return document.querySelector('.quiz-card') as HTMLElement;
};

let card: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="chat"></div>';
  tabs.clear();
  scripted.chunks = [];
  vi.mocked(setDraftText).mockClear();
  vi.mocked(downloadFile).mockClear();
  // Deterministic: pretend the user prefers reduced motion (skips confetti).
  vi.stubGlobal('matchMedia', (() => ({ matches: true })) as unknown as typeof matchMedia);
  initQuiz({ button: null, chatArea: document.getElementById('chat')! });
});

describe('features/quiz — per-question flow', () => {
  it('shows one question at a time, marks answers, reveals feedback and keeps score', () => {
    const session = makeSession();
    card = mount(session);

    expect(card.querySelectorAll('.quiz-question')).toHaveLength(1);
    expect(card.querySelector('.quiz-q')!.textContent).toBe('Q1');
    expect(card.querySelector('.quiz-counter')!.textContent).toBe('[quiz.progress]{"current":"1","total":"2"}');

    // Wrong answer on Q1 (answer is B)
    (card.querySelectorAll('.quiz-option')[0] as HTMLButtonElement).click();
    const options = [...card.querySelectorAll('.quiz-option')] as HTMLElement[];
    expect(options[0].classList.contains('wrong')).toBe(true);
    expect(options[1].classList.contains('correct')).toBe(true);
    expect(options.every((o) => (o as HTMLButtonElement).disabled)).toBe(true);
    expect(card.querySelector('.quiz-explanation')!.textContent).toContain('why [#2]');
    expect(btn(card, '[quiz.next]').disabled).toBe(false);
    expect(session.answers).toEqual([0, null]);

    // Feedback offers follow-up / variant for a wrong answer
    expect(btn(card, '[quiz.followup]')).toBeTruthy();
    expect(btn(card, '[quiz.variant]')).toBeTruthy();

    btn(card, '[quiz.next]').click();
    expect(card.querySelector('.quiz-q')!.textContent).toBe('Q2');
    expect(card.querySelector('.quiz-counter')!.textContent).toBe('[quiz.progress]{"current":"2","total":"2"}');

    // Correct answer on Q2 (answer is A) — no follow-up/variant offered
    (card.querySelectorAll('.quiz-option')[0] as HTMLButtonElement).click();
    expect(btn(card, '[quiz.followup]')).toBeUndefined();
    btn(card, '[quiz.finish]').click();

    expect(session.phase).toBe('summary');
    expect(card.querySelector('.quiz-ring-text')!.textContent).toBe('1/2');
    expect(card.querySelector('.quiz-grade')!.textContent).toBe('[quiz.grade.poor]');
    expect(card.querySelectorAll('.quiz-wrong-item')).toHaveLength(1);
  });

  it('renders an answered question statically (no replayed animations)', () => {
    const session = makeSession();
    session.answers = [1, null];
    card = mount(session);
    expect(card.querySelector('.quiz-question')!.classList.contains('static')).toBe(true);
    expect((card.querySelectorAll('.quiz-option')[1] as HTMLElement).classList.contains('correct')).toBe(true);
    expect([...card.querySelectorAll('.quiz-option')].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('retakes only the wrong questions from the summary', () => {
    const session = makeSession();
    session.answers = [0, 0]; // Q1 wrong, Q2 right
    session.phase = 'summary';
    card = mount(session);

    btn(card, '[quiz.retakeWrong]').click();
    expect(session.phase).toBe('answering');
    expect(session.quiz.questions).toHaveLength(1);
    expect(session.quiz.questions[0].question).toBe('Q1');
    expect(session.answers).toEqual([null]);
    expect(card.querySelector('.quiz-q')!.textContent).toBe('Q1');
    expect(card.querySelector('.quiz-question')!.classList.contains('static')).toBe(false);
  });

  it('pre-fills the chat draft with a self-contained follow-up', () => {
    const session = makeSession();
    session.answers = [0, null];
    card = mount(session);
    btn(card, '[quiz.followup]').click();
    const text = vi.mocked(setDraftText).mock.calls[0][0];
    expect(text).toContain('Q1');
    expect(text).toContain('A. a'); // the user's wrong choice
    expect(text).toContain('B. b'); // the correct answer
    expect(vi.mocked(setDraftText).mock.calls[0][1]).toEqual({ focus: true });
  });

  it('exports the quiz as Anki CSV from the summary', () => {
    const session = makeSession();
    session.answers = [1, 0];
    session.phase = 'summary';
    card = mount(session);
    btn(card, '[quiz.exportAnki]').click();
    expect(vi.mocked(downloadFile).mock.calls[0][0]).toContain('"F","B"');
  });
});

describe('features/quiz — flashcard deck', () => {
  it('flips, self-grades, summarizes and re-drills unknown cards', () => {
    const session = makeSession();
    session.answers = [1, 0];
    session.phase = 'summary';
    card = mount(session);

    btn(card, '[quiz.deck]').click();
    expect(session.phase).toBe('deck');
    expect(card.querySelector('.quiz-deck-count')!.textContent).toBe('[quiz.deckCount]{"current":"1","total":"2"}');
    expect(card.querySelector('.flashcard-face.front')!.textContent).toBe('F');

    // Grade buttons stay locked until the card has been flipped
    expect(btn(card, '[quiz.deckKnown]').disabled).toBe(true);
    (card.querySelector('.flashcard-scene') as HTMLElement).click();
    expect(card.querySelector('.flashcard-scene')!.classList.contains('flipped')).toBe(true);
    expect(btn(card, '[quiz.deckKnown]').disabled).toBe(false);

    btn(card, '[quiz.deckKnown]').click(); // F known
    expect(card.querySelector('.flashcard-face.front')!.textContent).toBe('F2');
    (card.querySelector('.flashcard-scene') as HTMLElement).click();
    btn(card, '[quiz.deckUnknown]').click(); // F2 not yet

    expect(card.textContent).toContain('[quiz.deckResult]{"known":"1","unknown":"1"}');
    btn(card, '[quiz.deckAgain]').click();
    expect(session.deck.order).toEqual([1]);
    expect(card.querySelector('.quiz-deck-count')!.textContent).toBe('[quiz.deckCount]{"current":"1","total":"1"}');
    // The re-drill shows the unknown card again — flip, grade, then results are back
    (card.querySelector('.flashcard-scene') as HTMLElement).click();
    btn(card, '[quiz.deckKnown]').click();
    expect(card.textContent).toContain('[quiz.deckResult]{"known":"1","unknown":"0"}');

    btn(card, '[quiz.backToSummary]').click();
    expect(session.phase).toBe('summary');
  });
});

describe('features/quiz — generation', () => {
  it('streams questions into the session one by one', async () => {
    const quizJson = JSON.stringify({
      questions: [
        { question: 'S1?', options: ['x', 'y'], answer: 0, explanation: 'e' },
        { question: 'S2?', options: ['u', 'v'], answer: 1, explanation: 'e2' },
      ],
      flashcards: [{ front: 'F', back: 'B' }],
    });
    // Awkward chunk boundaries — split mid-object, with a fence prefix.
    scripted.chunks = ['```json\n', quizJson.slice(0, 60), quizJson.slice(60)];
    tabs.set(1, { pageParagraphs: ['p1', 'p2'], pageTitle: 'T' });

    await startQuiz();
    await flush();

    const session = tabs.get(1)!.quizSession as QuizSession;
    expect(session.quiz.questions.map((q) => q.question)).toEqual(['S1?', 'S2?']);
    expect(session.quiz.flashcards).toEqual([{ front: 'F', back: 'B' }]);
    expect(session.answers).toEqual([null, null]);
    expect(session.generating).toBe(false);
    expect(session.phase).toBe('answering');
    expect(document.querySelector('.quiz-q')!.textContent).toBe('S1?');
  });

  it('appends a variant question from the wrong-answer feedback', async () => {
    const session = makeSession();
    session.answers = [0, null];
    card = mount(session);

    scripted.chunks = ['{"question":{"question":"V1?","opt', 'ions":["x","y"],"answer":1,"explanation":"v"}}'];
    btn(card, '[quiz.variant]').click();
    await flush();

    expect(session.quiz.questions).toHaveLength(3);
    expect(session.quiz.questions[2].question).toBe('V1?');
    expect(session.answers).toEqual([0, null, null]);
  });

  it('jumps straight to a variant question requested from the summary', async () => {
    const session = makeSession();
    session.answers = [0, 0];
    session.phase = 'summary';
    card = mount(session);

    scripted.chunks = ['{"question":{"question":"V2?","options":["x","y"],"answer":0,"explanation":"v"}}'];
    btn(card, '[quiz.variant]').click();
    await flush();

    expect(session.phase).toBe('answering');
    expect(session.current).toBe(2);
    expect(document.querySelector('.quiz-q')!.textContent).toBe('V2?');
  });
});
