// src/side_panel/state.js
//
// --- TypeScript Migration Boundary (Phase 5) ---
// Public API (exports below) is stable. Internal implementation may change
// during TypeScript migration as long as the getter/setter signatures are preserved.
// Key interfaces to preserve:
//   - subscribe(key, cb) / notify(key, value)
//   - switchToTab(tabId) / initState()
//   - defineTabField(name, default, opts) → getter/setter pairs
//   - All named exports listed at the bottom of this file
// --- End Migration Boundary ---

// Import centralized type definitions (side-effect import for JSDoc resolution)
import '../shared/types.js';

const listeners = new Map();

/**
 * Subscribe to state changes for a given key.
 * @param {string} key - State field name to observe
 * @param {(value: any) => void} callback - Called with the new value on change
 * @returns {() => void} Unsubscribe function
 */
export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => listeners.get(key)?.delete(callback);
}

function notify(key, value) {
  listeners.get(key)?.forEach(cb => cb(value));
}

// --- Per-tab state internals ---

const _tabStates = new Map();
let _activeState = null;
let _activeTabId = null;

/** @returns {TabState} */
function createFreshTabState() {
  return {
    pageContent: '',
    pageTitle: '',
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
    imageIndex: 0
  };
}

/**
 * Persist the active tab's state to chrome.storage.session.
 * Called internally after every state mutation.
 */
function persistTabState() {
  if (!_activeTabId || !_activeState) return;
  chrome.storage.session.set({ [`tabState_${_activeTabId}`]: _activeState });
}

/**
 * Switch the active tab context. Persists the outgoing tab state first,
 * then loads or creates state for the new tab.
 * @param {number} newTabId - Chrome tab ID to switch to
 * @returns {Promise<void>}
 */
export async function switchToTab(newTabId) {
  if (!newTabId || newTabId === _activeTabId) return;

  persistTabState();
  _activeTabId = newTabId;

  if (_tabStates.has(newTabId)) {
    _activeState = _tabStates.get(newTabId);
  } else {
    const stored = await chrome.storage.session.get(`tabState_${newTabId}`);
    _activeState = stored[`tabState_${newTabId}`] || createFreshTabState();
    _tabStates.set(newTabId, _activeState);
  }

  notify('tabSwitched');
}

/**
 * Initialize state on side-panel load: restore system prompt, active tab state,
 * quick commands, and suggest-questions preference.
 * @returns {Promise<void>}
 */
export async function initState() {
  const data = await chrome.storage.sync.get(['systemPrompt']);
  if (data.systemPrompt) _customSystemPrompt = data.systemPrompt;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    const tabId = tabs[0].id;
    _activeTabId = tabId;
    const stored = await chrome.storage.session.get(`tabState_${tabId}`);
    _activeState = stored[`tabState_${tabId}`] || createFreshTabState();
    _tabStates.set(tabId, _activeState);
  }

  const local = await chrome.storage.local.get(['quickCommands']);
  if (local.quickCommands) _quickCommands = local.quickCommands;

  const syncData = await chrome.storage.sync.get(['suggestQuestions']);
  if (syncData.suggestQuestions !== undefined) _suggestQuestionsEnabled = syncData.suggestQuestions;
}

// Clean up tab state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  _tabStates.delete(tabId);
  chrome.storage.session.remove(`tabState_${tabId}`);
  if (tabId === _activeTabId) {
    _activeState = null;
    _activeTabId = null;
  }
});

// --- Global state fields (unchanged — module-level variables) ---

let _customSystemPrompt = '';
export function getCustomSystemPrompt() { return _customSystemPrompt; }
export function setCustomSystemPrompt(v) { _customSystemPrompt = v; }

let _quickCommands = [];
export function getQuickCommands() { return _quickCommands; }
export function setQuickCommands(v) { _quickCommands = v; }

let _suggestQuestionsEnabled = true;
export function isSuggestQuestionsEnabled() { return _suggestQuestionsEnabled; }
export function setSuggestQuestionsEnabled(v) { _suggestQuestionsEnabled = v; }

export function getActiveTabId() { return _activeTabId; }

// 获取指定 tab 的 state 对象引用 —— 异步操作中用它绕过 _activeState，
// 避免切 tab 后数据写入错误的目标。
/**
 * Get the state object for a specific tab (bypasses _activeState).
 * Use in async operations to avoid writing to the wrong tab after a tab switch.
 * @param {number} tabId - Chrome tab ID
 * @returns {TabState|null}
 */
export function getStateForTab(tabId) {
  return _tabStates.get(tabId) || null;
}

// 将指定 tab 的 state 持久化到 chrome.storage.session
/**
 * Persist a specific tab's state to chrome.storage.session.
 * @param {number} tabId - Chrome tab ID
 * @returns {void}
 */
export function persistForTab(tabId) {
  const ts = _tabStates.get(tabId);
  if (ts) chrome.storage.session.set({ [`tabState_${tabId}`]: ts });
}

// --- Per-tab state fields (DRY via factory) ---
// defineTabField generates a getter/setter pair for each per-tab field.
// Getters return the current active state's field value (or a default).
// Setters mutate the active state, persist to session storage, and
// optionally notify subscribers via the key-based listener system.

const _generated = {};

/**
 * Generate getter/setter pair for a per-tab state field.
 * Reduces repetitive boilerplate: each field needs the same null-guard + persist pattern.
 * @param {string} name - Field name on the TabState object
 * @param {*} defaultValue - Default value when active state is null
 * @param {Object} [options]
 * @param {string}  [options.getterName] - Custom getter name (default: get<Name>)
 * @param {string}  [options.setterName] - Custom setter name (default: set<Name>)
 * @param {boolean} [options.notify]     - If true, setter publishes to listeners
 */
function defineTabField(name, defaultValue, options = {}) {
  const getterName = options.getterName || `get${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const setterName = options.setterName || `set${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const shouldNotify = options.notify || false;

  _generated[getterName] = () => _activeState?.[name] ?? defaultValue;
  _generated[setterName] = (v) => {
    if (!_activeState) return;
    _activeState[name] = v;
    persistTabState();
    if (shouldNotify) notify(name, v);
  };
}

defineTabField('pageContent', '');
defineTabField('pageExcerpt', '');
defineTabField('pageTitle', '');
defineTabField('isGenerating', false, { notify: true });
defineTabField('currentChatId', null);
defineTabField('selectedText', '');
defineTabField('ocrRunning', 0);
defineTabField('ocrResults', []);
defineTabField('imageIndex', 0);
defineTabField('isPodcastGenerating', false);
defineTabField('isChartGenerating', false);
defineTabField('detectedCharts', []);

// conversationHistory has extra mutation helpers beyond simple get/set
defineTabField('conversationHistory', []);
_generated.pushConversation = (msg) => { if (_activeState) { _activeState.conversationHistory.push(msg); persistTabState(); } };
_generated.spliceConversation = (...args) => { if (_activeState) { _activeState.conversationHistory.splice(...args); persistTabState(); } };
_generated.clearConversation = () => { if (_activeState) { _activeState.conversationHistory = []; persistTabState(); } };

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
  getIsChartGenerating, setIsChartGenerating,
  getDetectedCharts, setDetectedCharts,
  getConversationHistory, setConversationHistory,
  pushConversation, spliceConversation, clearConversation,
} = _generated;
