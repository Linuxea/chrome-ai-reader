/**
 * Quiz store — F12 study mode's reactive state, keyed by tab id (the React
 * counterpart of features/quiz.ts's module-level `_busy` / `_variantBusy` /
 * the DOM-resident flip state).
 *
 * SINGLE SOURCE DURING THE PANEL'S LIFETIME
 * `sessions` holds the live QuizSession per tab; every mutation flows through
 * `commit()`, which mirrors the session into `TabState.quizSession` via
 * tabs-store's `setQuizSessionForTab` — the immediate-persist semantics of
 * the legacy core (answer / streamed-question boundaries; a mid-quiz tab
 * switch or panel reopen never loses progress). Restore goes the other way:
 * `adopt()` picks up `TabState.quizSession` when the store has no entry
 * (fresh panel over an existing tab state). `restoreTabState` in the core
 * strips `generating`, so a quiz stream never survives a reopen as stuck.
 *
 * The quiz is NOT part of the conversation: nothing here ever reaches
 * `conversationHistory`, and the tab's `isGenerating` flag is untouched (the
 * chat Stop button must stay a chat stop).
 */
import { create } from 'zustand';
import type { QuizSession } from '@/shared/quiz';
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';

interface QuizStore {
  /** Live quiz sessions by tab id — a stream finishing in a background tab
   * keeps committing here; the card shows whichever tab is active. */
  sessions: Record<number, QuizSession | undefined>;
  /** A variant-question request is in flight for the tab (one at a time). */
  variantBusy: Record<number, boolean | undefined>;
  /** The deck's current card is flipped (view state — never persisted). */
  flipped: Record<number, boolean | undefined>;

  /** Fresh generating session for the tab (persisted; the card mounts at once). */
  begin: (tabId: number) => QuizSession;
  /** Replace the session immutably AND persist it now (the one commit path). */
  commit: (tabId: number, session: QuizSession) => void;
  /** Adopt the tab's persisted session when the store has none (restore). Returns it. */
  adopt: (tabId: number) => QuizSession | null;
  /** Drop the session from the store and from TabState (cancel with nothing kept). */
  discard: (tabId: number) => void;

  setVariantBusy: (tabId: number, v: boolean) => void;
  setFlipped: (tabId: number, v: boolean) => void;
}

function freshSession(): QuizSession {
  return {
    quiz: { questions: [], flashcards: [] },
    answers: [],
    current: 0,
    phase: 'answering',
    deck: { index: 0, order: [], known: [] },
    generating: true,
  };
}

export const useQuizStore = create<QuizStore>()((set, get) => ({
  sessions: {},
  variantBusy: {},
  flipped: {},

  begin: tabId => {
    const session = freshSession();
    set(s => ({ sessions: { ...s.sessions, [tabId]: session } }));
    useTabsStore.getState().setQuizSessionForTab(tabId, session);
    return session;
  },

  commit: (tabId, session) => {
    set(s => ({ sessions: { ...s.sessions, [tabId]: session } }));
    // Immediate persist at answer / question boundaries (legacy semantics —
    // never the debounced field path).
    useTabsStore.getState().setQuizSessionForTab(tabId, session);
  },

  adopt: tabId => {
    const existing = get().sessions[tabId];
    if (existing) return existing;
    const stored = core.getStateForTab(tabId)?.quizSession;
    if (!stored) return null;
    // restoreTabState already stripped `generating`; strip again in case the
    // entry came from an in-place mutation during this panel's lifetime.
    const session: QuizSession = { ...stored, generating: false };
    set(s => ({ sessions: { ...s.sessions, [tabId]: session } }));
    return session;
  },

  discard: tabId => {
    set(s => {
      if (!(tabId in s.sessions)) return s;
      const sessions = { ...s.sessions };
      delete sessions[tabId];
      return { sessions };
    });
    useTabsStore.getState().setQuizSessionForTab(tabId, null);
  },

  setVariantBusy: (tabId, v) =>
    set(s => ({ variantBusy: { ...s.variantBusy, [tabId]: v } })),

  setFlipped: (tabId, v) =>
    set(s => ({ flipped: { ...s.flipped, [tabId]: v } })),
}));

// --- Hooks / selectors ---------------------------------------------------------

/** The active tab's session, restored lazily from TabState when the store has
 *  none (panel reopened) — the React equivalent of QUIZ_REBUILD_REQUEST. */
export function adoptQuizForTab(tabId: number | null): QuizSession | null {
  return tabId != null ? useQuizStore.getState().adopt(tabId) : null;
}
