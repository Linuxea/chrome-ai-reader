import type { TabState, ChatMessage, OcrResult } from '../shared/types';

const listeners = new Map<string, Set<(value: unknown) => void>>();

export function subscribe(key: string, callback: (value: unknown) => void): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(callback);
  return () => listeners.get(key)?.delete(callback);
}

function notify(key: string, value: unknown): void {
  listeners.get(key)?.forEach(cb => cb(value));
}

const _tabStates = new Map<number, TabState>();
let _activeState: TabState | null = null;
let _activeTabId: number | null = null;

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

function persistTabState(): void {
  if (!_activeTabId || !_activeState) return;
  chrome.storage.session.set({ [`tabState_${_activeTabId}`]: _activeState });
}

export async function switchToTab(newTabId: number): Promise<void> {
  if (!newTabId || newTabId === _activeTabId) return;

  persistTabState();
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

// --- Global state fields ---

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

export function persistForTab(tabId: number): void {
  const ts = _tabStates.get(tabId);
  if (ts) chrome.storage.session.set({ [`tabState_${tabId}`]: ts });
}

// --- Per-tab state fields (DRY via factory) ---

interface GeneratedAccessors {
  [key: string]: (...args: unknown[]) => unknown;
}

const _generated: GeneratedAccessors = {};

function defineTabField<T>(
  name: keyof TabState,
  defaultValue: T,
  options?: { getterName?: string; setterName?: string; notify?: boolean },
): void {
  const getterName = options?.getterName || `get${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const setterName = options?.setterName || `set${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const shouldNotify = options?.notify || false;

  (_generated as Record<string, () => T>)[getterName] = () => _activeState?.[name] as T ?? defaultValue;
  (_generated as Record<string, (v: T) => void>)[setterName] = (v: T) => {
    if (!_activeState) return;
    (_activeState as unknown as Record<string, unknown>)[name] = v;
    persistTabState();
    if (shouldNotify) notify(name, v);
  };
}

defineTabField('pageContent', '');
defineTabField('pageExcerpt', '');
defineTabField('pageTitle', '');
defineTabField('isGenerating', false, { notify: true });
defineTabField('currentChatId', null as string | null);
defineTabField('selectedText', '');
defineTabField('ocrRunning', 0);
defineTabField('ocrResults', [] as OcrResult[]);
defineTabField('imageIndex', 0);
defineTabField('isPodcastGenerating', false);

defineTabField('conversationHistory', [] as ChatMessage[]);
(_generated as Record<string, (msg: ChatMessage) => void>).pushConversation = (msg: ChatMessage) => {
  if (_activeState) { _activeState.conversationHistory.push(msg); persistTabState(); }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(_generated as any).spliceConversation = (...args: Parameters<Array<ChatMessage>['splice']>) => {
  if (_activeState) { _activeState.conversationHistory.splice(...args); persistTabState(); }
};
(_generated as Record<string, () => void>).clearConversation = () => {
  if (_activeState) { _activeState.conversationHistory = []; persistTabState(); }
};

export const {
  getPageContent, setPageContent,
  getPageExcerpt, setPageExcerpt,
  getPageTitle, setPageTitle,
  getIsGenerating, setIsGenerating,
  getCurrentChatId, setCurrentChatId,
  getSelectedText, setSelectedText,
  getOcrRunning, setOcrRunning,
  getOcrResults, setOcrResults,
  getImageIndex, setImageIndex,
  getIsPodcastGenerating, setIsPodcastGenerating,
  getConversationHistory, setConversationHistory,
  pushConversation, spliceConversation, clearConversation,
} = _generated as {
  getPageContent: () => string;
  setPageContent: (v: string) => void;
  getPageExcerpt: () => string;
  setPageExcerpt: (v: string) => void;
  getPageTitle: () => string;
  setPageTitle: (v: string) => void;
  getIsGenerating: () => boolean;
  setIsGenerating: (v: boolean) => void;
  getCurrentChatId: () => string | null;
  setCurrentChatId: (v: string | null) => void;
  getSelectedText: () => string;
  setSelectedText: (v: string) => void;
  getOcrRunning: () => number;
  setOcrRunning: (v: number) => void;
  getOcrResults: () => OcrResult[];
  setOcrResults: (v: OcrResult[]) => void;
  getImageIndex: () => number;
  setImageIndex: (v: number) => void;
  getIsPodcastGenerating: () => boolean;
  setIsPodcastGenerating: (v: boolean) => void;
  getConversationHistory: () => ChatMessage[];
  setConversationHistory: (v: ChatMessage[]) => void;
  pushConversation: (msg: ChatMessage) => void;
  spliceConversation: (...args: Parameters<Array<ChatMessage>['splice']>) => void;
  clearConversation: () => void;
};
