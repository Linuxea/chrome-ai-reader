import type { TabState, ChatMessage, OcrResult } from '../shared/types';
import { stripImagesForPersistence } from './services/chat/strip-images';

/**
 * Debounce window for field-setter persistence. High-frequency setters
 * (setPageContent during extraction, OCR progress counters, …) must not
 * serialize the whole TabState — including conversationHistory — into
 * chrome.storage.session on every call. Message-boundary writes
 * (conversation helpers, persistForTab, tab switch) bypass the debounce
 * and flush immediately.
 */
const PERSIST_DEBOUNCE_MS = 250;

// --- Keyed listeners --------------------------------------------------------

const listeners = new Map<string, Set<(value: unknown) => void>>();

export function subscribe(key: string, callback: (value: unknown) => void): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(callback);
  return () => listeners.get(key)?.delete(callback);
}

function notify(key: string, value: unknown): void {
  listeners.get(key)?.forEach(cb => cb(value));
}

// --- Per-tab state storage --------------------------------------------------

const _tabStates = new Map<number, TabState>();
let _activeState: TabState | null = null;
let _activeTabId: number | null = null;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function createFreshTabState(): TabState {
  return {
    pageContent: '',
    pageTitle: '',
    pageExcerpt: '',
    conversationHistory: [],
    currentChatId: null,
    selectedText: '',
    isGenerating: false,
    isPodcastGenerating: false,
    ocrRunning: 0,
    ocrResults: [],
    imageIndex: 0,
  };
}

function writeTabState(tabId: number, ts: TabState): void {
  const persistable: TabState = {
    ...ts,
    conversationHistory: ts.conversationHistory.map(stripImagesForPersistence),
  };
  chrome.storage.session.set({ [`tabState_${tabId}`]: persistable });
}

function cancelScheduledPersist(): void {
  if (_persistTimer !== null) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
}

/** Debounced persist for high-frequency field setters. */
function schedulePersist(): void {
  if (_activeTabId == null || !_activeState) return;
  cancelScheduledPersist();
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    if (_activeTabId != null && _activeState) writeTabState(_activeTabId, _activeState);
  }, PERSIST_DEBOUNCE_MS);
}

/** Immediate persist — message boundaries and pre-tab-switch flush. */
function persistActiveNow(): void {
  cancelScheduledPersist();
  if (_activeTabId != null && _activeState) writeTabState(_activeTabId, _activeState);
}

export async function switchToTab(newTabId: number): Promise<void> {
  if (!newTabId || newTabId === _activeTabId) return;

  persistActiveNow();
  _activeTabId = newTabId;

  if (_tabStates.has(newTabId)) {
    _activeState = _tabStates.get(newTabId)!;
  } else {
    const stored = await chrome.storage.session.get(`tabState_${newTabId}`);
    _activeState = (stored[`tabState_${newTabId}`] as TabState | undefined) || createFreshTabState();
    _tabStates.set(newTabId, _activeState);
  }

  notify('tabSwitched', undefined);
}

export async function initState(): Promise<void> {
  const data = await chrome.storage.sync.get(['systemPrompt']);
  if (data.systemPrompt) _customSystemPrompt = data.systemPrompt as string;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id != null) {
    const tabId = tabs[0].id;
    _activeTabId = tabId;
    const stored = await chrome.storage.session.get(`tabState_${tabId}`);
    _activeState = (stored[`tabState_${tabId}`] as TabState | undefined) || createFreshTabState();
    _tabStates.set(tabId, _activeState);
  }

  const local = await chrome.storage.local.get(['quickCommands']);
  if (local.quickCommands) _quickCommands = local.quickCommands as QuickCommand[];

  const syncData = await chrome.storage.sync.get(['suggestQuestions']);
  if (syncData.suggestQuestions !== undefined) _suggestQuestionsEnabled = syncData.suggestQuestions as boolean;

  // Register tab-cleanup listener during init (not at module load) so tests
  // can import state.ts without chrome.tabs being present first.
  initTabLifecycleListener();
}

let _tabLifecycleListenerRegistered = false;
function initTabLifecycleListener(): void {
  if (_tabLifecycleListenerRegistered) return;
  _tabLifecycleListenerRegistered = true;
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    _tabStates.delete(tabId);
    chrome.storage.session.remove(`tabState_${tabId}`);
    if (tabId === _activeTabId) {
      cancelScheduledPersist();
      _activeState = null;
      _activeTabId = null;
    }
  });
}

// Backwards-compat: register the listener at module load for production use
// (mirrors the original behavior). initState() is idempotent and will not
// double-register. This keeps existing importers working without changes.
if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
  initTabLifecycleListener();
}

// --- Global state fields ----------------------------------------------------

let _customSystemPrompt = '';
export function getCustomSystemPrompt(): string { return _customSystemPrompt; }
export function setCustomSystemPrompt(v: string): void { _customSystemPrompt = v; }

export interface QuickCommand {
  id?: string;
  name: string;
  prompt: string;
  icon?: string;
}

let _quickCommands: QuickCommand[] = [];
export function getQuickCommands(): QuickCommand[] { return _quickCommands; }
export function setQuickCommands(v: QuickCommand[]): void { _quickCommands = v; }

let _suggestQuestionsEnabled = true;
export function isSuggestQuestionsEnabled(): boolean { return _suggestQuestionsEnabled; }
export function setSuggestQuestionsEnabled(v: boolean): void { _suggestQuestionsEnabled = v; }

export function getActiveTabId(): number | null { return _activeTabId; }

export function getStateForTab(tabId: number): TabState | null {
  return _tabStates.get(tabId) || null;
}

/** Immediate persist of a tab's state — used by history-ops at message boundaries. */
export function persistForTab(tabId: number): void {
  if (tabId === _activeTabId) cancelScheduledPersist();
  const ts = _tabStates.get(tabId);
  if (!ts) return;
  writeTabState(tabId, ts);
}

// --- Per-tab field accessors ------------------------------------------------
// Explicit getter/setter pairs — no runtime name synthesis. New fields are
// added to TabState (shared/types.ts) and get a pair here; grep-able and
// type-checked end to end.

export function getPageContent(): string { return _activeState?.pageContent ?? ''; }
export function setPageContent(v: string): void { if (!_activeState) return; _activeState.pageContent = v; schedulePersist(); }

export function getPageExcerpt(): string { return _activeState?.pageExcerpt ?? ''; }
export function setPageExcerpt(v: string): void { if (!_activeState) return; _activeState.pageExcerpt = v; schedulePersist(); }

export function getPageTitle(): string { return _activeState?.pageTitle ?? ''; }
export function setPageTitle(v: string): void { if (!_activeState) return; _activeState.pageTitle = v; schedulePersist(); }

export function getIsGenerating(): boolean { return _activeState?.isGenerating ?? false; }
export function setIsGenerating(v: boolean): void {
  if (!_activeState) return;
  _activeState.isGenerating = v;
  schedulePersist();
  notify('isGenerating', v);
}

export function getCurrentChatId(): string | null { return _activeState?.currentChatId ?? null; }
export function setCurrentChatId(v: string | null): void { if (!_activeState) return; _activeState.currentChatId = v; schedulePersist(); }

export function getSelectedText(): string { return _activeState?.selectedText ?? ''; }
export function setSelectedText(v: string): void { if (!_activeState) return; _activeState.selectedText = v; schedulePersist(); }

export function getOcrRunning(): number { return _activeState?.ocrRunning ?? 0; }
export function setOcrRunning(v: number): void { if (!_activeState) return; _activeState.ocrRunning = v; schedulePersist(); }

export function getOcrResults(): OcrResult[] { return _activeState?.ocrResults ?? []; }
export function setOcrResults(v: OcrResult[]): void { if (!_activeState) return; _activeState.ocrResults = v; schedulePersist(); }

export function getImageIndex(): number { return _activeState?.imageIndex ?? 0; }
export function setImageIndex(v: number): void { if (!_activeState) return; _activeState.imageIndex = v; schedulePersist(); }

export function getIsPodcastGenerating(): boolean { return _activeState?.isPodcastGenerating ?? false; }
export function setIsPodcastGenerating(v: boolean): void { if (!_activeState) return; _activeState.isPodcastGenerating = v; schedulePersist(); }

// --- Conversation history ---------------------------------------------------
// History mutations are message boundaries — they persist immediately rather
// than going through the debounced setter path.

export function getConversationHistory(): ChatMessage[] { return _activeState?.conversationHistory ?? []; }
export function setConversationHistory(v: ChatMessage[]): void { if (!_activeState) return; _activeState.conversationHistory = v; persistActiveNow(); }

export function pushConversation(msg: ChatMessage): void {
  if (!_activeState) return;
  _activeState.conversationHistory.push(msg);
  persistActiveNow();
}

export function spliceConversation(...args: Parameters<Array<ChatMessage>['splice']>): void {
  if (!_activeState) return;
  _activeState.conversationHistory.splice(...args);
  persistActiveNow();
}

export function clearConversation(): void {
  if (!_activeState) return;
  _activeState.conversationHistory = [];
  persistActiveNow();
}
