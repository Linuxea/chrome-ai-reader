import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { t } from '@/shared/i18n.js';

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

import { useTabsStore } from '@/panel/stores/tabs-store';
import { useQuizStore } from '@/panel/stores/quiz-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import type { QuizSession } from '@/shared/quiz';
import { QuizCard } from '@/panel/components/panels/QuizCard';

function baseSession(overrides: Partial<QuizSession> = {}): QuizSession {
  return {
    quiz: {
      questions: [{ question: 'What is 2+2?', options: ['3', '4'], answer: 1, explanation: 'Basic math [#1]', paragraph: 1 }],
      flashcards: [
        { front: 'F1', back: 'B1' },
        { front: 'F2', back: 'B2' },
      ],
    },
    answers: [null],
    current: 0,
    phase: 'answering',
    deck: { index: 0, order: [], known: [] },
    generating: false,
    ...overrides,
  };
}

function seed(session: QuizSession | undefined): void {
  useQuizStore.setState(s => ({ sessions: { ...s.sessions, 42: session } }));
}

describe('QuizCard (smoke)', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    useQuizStore.setState({ sessions: {}, variantBusy: {}, flipped: {} });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
  });

  it('renders nothing when the active tab has no session', () => {
    const { container } = render(<QuizCard />);
    expect(container.querySelector('.quiz-card')).toBeNull();
  });

  it('adopts a persisted session from TabState on mount (reopen / tab switch)', () => {
    useTabsStore.getState().setQuizSessionForTab(42, baseSession());
    const { container } = render(<QuizCard />);
    expect(container.querySelector('.quiz-card')).toBeTruthy();
    expect(useQuizStore.getState().sessions[42]?.quiz.questions).toHaveLength(1);
  });

  it('generating state: spinner copy + stop affordance, no options yet', () => {
    seed(baseSession({ generating: true, quiz: { questions: [], flashcards: [] }, answers: [] }));
    const { container } = render(<QuizCard />);
    expect(container.querySelector('.quiz-status')!.textContent).toContain(t('quiz.generating'));
    expect(container.querySelector('.quiz-stop')).toBeTruthy();
    expect(container.querySelector('.quiz-option')).toBeNull();
  });

  it('answering: click records the answer, paints correct/wrong, shows feedback + next', () => {
    seed(baseSession());
    const { container } = render(<QuizCard />);

    const options = [...container.querySelectorAll('.quiz-option')] as HTMLButtonElement[];
    expect(options).toHaveLength(2);
    expect(options[0]!.textContent).toContain('A. 3');

    fireEvent.click(options[0]!); // wrong (answer is B)
    const persisted = useQuizStore.getState().sessions[42]!;
    expect(persisted.answers[0]).toBe(0);

    expect(container.querySelector('.quiz-question')!.classList.contains('static')).toBe(true);
    expect(options[0]!.classList.contains('wrong')).toBe(true);
    expect(options[0]!.classList.contains('chosen')).toBe(true);
    expect(options[1]!.classList.contains('correct')).toBe(true);
    expect(container.querySelector('.quiz-feedback')!.textContent).toContain('Basic math');
    // Single question → the finish button, not "next".
    expect(screen.getByRole('button', { name: t('quiz.finish') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('quiz.next') })).toBeNull();
  });

  it('an already-answered question renders statically with feedback (restore)', () => {
    seed(baseSession({ answers: [1] })); // answered correctly
    const { container } = render(<QuizCard />);

    expect(container.querySelector('.quiz-question')!.classList.contains('static')).toBe(true);
    const options = [...container.querySelectorAll('.quiz-option')] as HTMLButtonElement[];
    expect(options[1]!.classList.contains('correct')).toBe(true);
    expect(options.every(o => o.disabled)).toBe(true);
    expect(container.querySelector('.quiz-feedback')!.textContent).toContain('Basic math');
  });

  it('wrong answers expose follow-up (pre-fills the composer) and variant actions', () => {
    seed(baseSession({ answers: [0] }));
    render(<QuizCard />);

    const followup = screen.getByRole('button', { name: t('quiz.followup') });
    fireEvent.click(followup);
    expect(useComposerStore.getState().draftText).toContain('What is 2+2?');

    expect(screen.getByRole('button', { name: t('quiz.variant') })).toBeTruthy();
  });

  it('last question while still generating shows the disabled generatingMore button', () => {
    seed(baseSession({ generating: true }));
    const { container } = render(<QuizCard />);
    fireEvent.click(container.querySelectorAll('.quiz-option')[1]!); // answer correctly
    const finish = screen.getByRole('button', { name: t('quiz.generatingMore') }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
  });

  it('summary: score ring, grade, wrong review and the deck entry point', () => {
    seed(baseSession({
      answers: [1],
      phase: 'summary',
    }));
    const { container } = render(<QuizCard />);

    expect(container.querySelector('.quiz-ring-text')!.textContent).toBe('1/1');
    expect(container.textContent).toContain(t('quiz.grade.great'));
    expect(screen.getByRole('button', { name: t('quiz.deck') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('quiz.again') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('quiz.exportAnki') })).toBeTruthy();
    // All correct → no wrong review block.
    expect(container.querySelector('.quiz-wrong-list')).toBeNull();
  });

  it('deck: flip unlocks grading; grading advances; the run ends in the stats view', () => {
    seed(baseSession({ phase: 'summary', answers: [1] }));
    const { container } = render(<QuizCard />);

    fireEvent.click(screen.getByRole('button', { name: t('quiz.deck') }));
    expect(useQuizStore.getState().sessions[42]!.phase).toBe('deck');

    let scene = container.querySelector('.flashcard-scene')!;
    expect(container.querySelector('.quiz-deck-count')!.textContent).toContain('1 / 2');
    const known = screen.getByRole('button', { name: t('quiz.deckKnown') }) as HTMLButtonElement;
    expect(known.disabled).toBe(true); // grade only after the first flip

    fireEvent.click(scene);
    expect(useQuizStore.getState().flipped[42]).toBe(true);
    expect(container.querySelector('.flashcard-scene')!.classList.contains('flipped')).toBe(true);
    expect(known.disabled).toBe(false);

    fireEvent.click(known); // card 1 known
    expect(useQuizStore.getState().sessions[42]!.deck.index).toBe(1);
    expect(container.querySelector('.flashcard-scene')!.classList.contains('flipped')).toBe(false); // next starts face-down
    expect(container.querySelector('.quiz-deck-count')!.textContent).toContain('2 / 2');

    const unknown = screen.getByRole('button', { name: t('quiz.deckUnknown') });
    scene = container.querySelector('.flashcard-scene')!;
    fireEvent.click(scene); // flip
    fireEvent.click(unknown); // card 2 unknown → run finished
    expect(container.textContent).toContain(t('quiz.deckResult', { known: '1', unknown: '1' }));
    expect(screen.getByRole('button', { name: t('quiz.deckAgain') })).toBeTruthy();
  });
});
