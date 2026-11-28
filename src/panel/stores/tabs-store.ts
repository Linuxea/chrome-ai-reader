/**
 * Tabs store — the panel's reactive face over the framework-free tab-state
 * core (`src/side_panel/state.ts`).
 *
 * WHY A WRAPPER, NOT A PORT
 * The legacy core already implements every subtle persistence semantic —
 * 250ms-debounced field writes, immediate message-boundary flushes, the
 * quota-fallback write, never-restoring in-flight flags, tab lifecycle
 * cleanup — and ~30 tests pin them down. Reimplementing that in zustand
 * would fork the semantics; instead the core stays the single source of
 * truth and this store adds the one thing it lacks: change notification.
 *
 * VERSION-COUNTER PATTERN
 * The core mutates TabState objects in place (PURE services like
 * history-ops rely on that), which is invisible to React's reference
 * equality. Every action therefore delegates to the core (or a PURE
 * service) and then bumps `version`; hooks subscribe to `version` and
 * re-read core state on change. The core's own notifications
 * (tabSwitched / isGenerating / pageInvalidated) are bridged the same way.
 */
import { create } from 'zustand';
import * as core from '@/panel/state';
import type { QuickCommand } from '@/panel/state';
import * as historyOps from '@/panel/lib/history-ops';
import type { ChatMessage, TabState } from '@/shared/types';
import type { QuizSession } from '@/shared/quiz';

export interface TabsStoreState {
  /** Bumped on every mutation that flows through this store or a bridged
   * core notification. Subscribe to this, then read core state fresh. */
  version: number;
  activeTabId: number | null;
  /** Mirror of the ACTIVE tab's flag (kept current via the core bridge). */
  isGenerating: boolean;
  customSystemPrompt: string;
  quickCommands: QuickCommand[];
  suggestQuestionsEnabled: boolean;

  init: (bindTabId?: number) => Promise<void>;
  switchToTab: (tabId: number) => Promise<void>;
  /** Force subscribers to re-read core state (after core mutations made
   * outside this store — e.g. a stream finishing in a background tab). */
  bump: () => void;

  // Field setters (debounced-persist semantics live in the core).
  setPageContent: (v: string) => void;
  setPageExcerpt: (v: string) => void;
  setPageTitle: (v: string) => void;
  setSelectedText: (v: string) => void;
  setCurrentChatId: (v: string | null) => void;
  setChatTitle: (v: string) => void;
  setImageIndex: (v: number) => void;
  setIsPodcastGenerating: (v: boolean) => void;
  setCustomSystemPrompt: (v: string) => void;
  setQuickCommands: (v: QuickCommand[]) => void;
  setSuggestQuestionsEnabled: (v: boolean) => void;

  /** Single writer for any tab's generating flag — the tab may not be the
   * active one (a stream finishing in the background). Mirrors + bumps. */
  setGeneratingForTab: (tabId: number, v: boolean) => void;

  // Conversation operations — message boundaries, immediate persist.
  appendMessage: (msg: ChatMessage) => void;
  setConversationHistory: (v: ChatMessage[]) => void;
  clearConversation: () => void;
  rollbackTrailingUserMessage: () => boolean;
  truncateHistoryFromUserContent: (userContent: string) => number;
  truncateHistoryFromId: (id: string) => number;
  branchFromId: (id: string) => number;
  switchBranch: (anchor: string, to: number) => boolean;

  setQuizSessionForTab: (tabId: number, v: QuizSession | null) => void;
}

let bridgeInstalled = false;

function mirrorCore(): Partial<TabsStoreState> {
  return {
    activeTabId: core.getActiveTabId(),
    isGenerating: core.getIsGenerating(),
    customSystemPrompt: core.getCustomSystemPrompt(),
    quickCommands: core.getQuickCommands(),
    suggestQuestionsEnabled: core.isSuggestQuestionsEnabled(),
  };
}

function installBridge(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  core.subscribe('tabSwitched', () => useTabsStore.setState(s => ({ ...mirrorCore(), version: s.version + 1 })));
  core.subscribe('isGenerating', v => useTabsStore.setState({ isGenerating: v }));
  core.subscribe('pageInvalidated', () => useTabsStore.setState(s => ({ version: s.version + 1 })));
}

export const useTabsStore = create<TabsStoreState>()((set, get) => ({
  version: 0,
  activeTabId: null,
  isGenerating: false,
  customSystemPrompt: '',
  quickCommands: [],
  suggestQuestionsEnabled: true,

  init: async (bindTabId?: number) => {
    installBridge();
    // F17: the fullscreen page binds the conversation's tab (its URL's `tab`
    // param) — itself being a tab, the active-tab query would resolve to it.
    await core.initState(bindTabId != null ? { bindTabId } : undefined);
    set(s => ({ ...mirrorCore(), version: s.version + 1 }));
  },

  switchToTab: async tabId => {
    await core.switchToTab(tabId);
    set(s => ({ ...mirrorCore(), version: s.version + 1 }));
  },

  bump: () => set(s => ({ version: s.version + 1, ...mirrorCore() })),

  setPageContent: v => { core.setPageContent(v); get().bump(); },
  setPageExcerpt: v => { core.setPageExcerpt(v); get().bump(); },
  setPageTitle: v => { core.setPageTitle(v); get().bump(); },
  setSelectedText: v => { core.setSelectedText(v); get().bump(); },
  setCurrentChatId: v => { core.setCurrentChatId(v); get().bump(); },
  setChatTitle: v => { core.setChatTitle(v); get().bump(); },
  setImageIndex: v => { core.setImageIndex(v); get().bump(); },
  setIsPodcastGenerating: v => { core.setIsPodcastGenerating(v); get().bump(); },
  setCustomSystemPrompt: v => { core.setCustomSystemPrompt(v); set({ customSystemPrompt: v }); },
  setQuickCommands: v => { core.setQuickCommands(v); set({ quickCommands: [...v] }); },
  setSuggestQuestionsEnabled: v => { core.setSuggestQuestionsEnabled(v); set({ suggestQuestionsEnabled: v }); },

  setGeneratingForTab: (tabId, v) => {
    core.setGeneratingForTab(tabId, v);
    // Mirror ourselves: the core only notifies `isGenerating` for the active
    // tab, and bump regardless so a background tab's flag flip re-renders.
    set(s => ({ isGenerating: tabId === s.activeTabId ? v : s.isGenerating, version: s.version + 1 }));
  },

  appendMessage: msg => {
    const { tabId, ts } = activePair();
    if (!ts || tabId == null) return;
    historyOps.appendMessage(ts, msg, tabId);
    get().bump();
  },

  setConversationHistory: v => {
    core.setConversationHistory(v);
    get().bump();
  },

  clearConversation: () => {
    core.clearConversation();
    get().bump();
  },

  rollbackTrailingUserMessage: () => {
    const { tabId, ts } = activePair();
    if (!ts || tabId == null) return false;
    const removed = historyOps.rollbackTrailingUserMessage(ts, tabId);
    if (removed) get().bump();
    return removed;
  },

  truncateHistoryFromUserContent: userContent => {
    const { tabId, ts } = activePair();
    if (!ts || tabId == null) return -1;
    const idx = historyOps.truncateHistoryFromUserContent(ts, userContent, tabId);
    if (idx !== -1) get().bump();
    return idx;
  },

  truncateHistoryFromId: id => {
    const { tabId, ts } = activePair();
    if (!ts || tabId == null) return -1;
    const idx = historyOps.truncateHistoryFromId(ts, id, tabId);
    if (idx !== -1) get().bump();
    return idx;
  },

  branchFromId: id => {
    const { tabId, ts } = activePair();
    if (!ts || tabId == null) return -1;
    const idx = historyOps.branchFromId(ts, id, tabId);
    if (idx !== -1) get().bump();
    return idx;
  },

  switchBranch: (anchor, to) => {
    const { tabId, ts } = activePair();
    if (!ts || tabId == null) return false;
    // Guard: switching mid-generation splices the LIVE tail (with the
    // in-flight turn) into a branch — the finishing answer would land on
    // the WRONG branch (legacy guarded BRANCH_SWITCH the same way).
    if (ts.isGenerating) return false;
    const ok = historyOps.switchBranch(ts, anchor, to, tabId);
    if (ok) get().bump();
    return ok;
  },

  setQuizSessionForTab: (tabId, v) => {
    core.setQuizSessionForTab(tabId, v);
    get().bump();
  },
}));

function activePair(): { tabId: number | null; ts: TabState | null } {
  const tabId = core.getActiveTabId();
  return { tabId, ts: tabId != null ? core.getStateForTab(tabId) : null };
}

// --- Hooks -------------------------------------------------------------------

/**
 * The live TabState of the active tab. Subscribes to `version` so in-place
 * mutations (the core + PURE services) still re-render consumers; returns
 * the SAME object across bumps — derive display data during render.
 */
export function useActiveTabState(): TabState | null {
  useTabsStore(s => s.version); // mutation signal
  const activeTabId = useTabsStore(s => s.activeTabId);
  return activeTabId != null ? core.getStateForTab(activeTabId) : null;
}
