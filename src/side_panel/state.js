// src/side_panel/state.js
const listeners = new Map();

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

function persistTabState() {
  if (!_activeTabId || !_activeState) return;
  chrome.storage.session.set({ [`tabState_${_activeTabId}`]: _activeState });
}

export async function switchToTab(newTabId) {
  if (newTabId === _activeTabId) return;

  persistTabState();
  _activeTabId = newTabId;

  const stored = await chrome.storage.session.get(`tabState_${newTabId}`);
  _activeState = stored[`tabState_${newTabId}`]
    ? stored[`tabState_${newTabId}`]
    : createFreshTabState();
  _tabStates.set(newTabId, _activeState);

  notify('tabSwitched');
}

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

// --- Per-tab state fields (now read/write through _activeState) ---

export function getPageContent() { return _activeState?.pageContent || ''; }
export function setPageContent(v) { _activeState.pageContent = v; persistTabState(); }

export function getPageExcerpt() { return _activeState?.pageExcerpt || ''; }
export function setPageExcerpt(v) { _activeState.pageExcerpt = v; persistTabState(); }

export function getPageTitle() { return _activeState?.pageTitle || ''; }
export function setPageTitle(v) { _activeState.pageTitle = v; persistTabState(); }

export function getConversationHistory() { return _activeState?.conversationHistory || []; }
export function setConversationHistory(v) { _activeState.conversationHistory = v; persistTabState(); }
export function pushConversation(msg) { _activeState.conversationHistory.push(msg); persistTabState(); }
export function spliceConversation(...args) { _activeState.conversationHistory.splice(...args); persistTabState(); }
export function clearConversation() { _activeState.conversationHistory = []; persistTabState(); }

export function getIsGenerating() { return _activeState?.isGenerating || false; }
export function setIsGenerating(v) { _activeState.isGenerating = v; persistTabState(); notify('isGenerating', v); }

export function getCurrentChatId() { return _activeState?.currentChatId || null; }
export function setCurrentChatId(v) { _activeState.currentChatId = v; persistTabState(); }

export function getSelectedText() { return _activeState?.selectedText || ''; }
export function setSelectedText(v) { _activeState.selectedText = v; persistTabState(); }

export function getOcrRunning() { return _activeState?.ocrRunning || 0; }
export function setOcrRunning(v) { _activeState.ocrRunning = v; persistTabState(); }

export function getOcrResults() { return _activeState?.ocrResults || []; }
export function setOcrResults(v) { _activeState.ocrResults = v; persistTabState(); }

export function getImageIndex() { return _activeState?.imageIndex || 0; }
export function setImageIndex(v) { _activeState.imageIndex = v; persistTabState(); }

export function getIsPodcastGenerating() { return _activeState?.isPodcastGenerating || false; }
export function setIsPodcastGenerating(v) { _activeState.isPodcastGenerating = v; persistTabState(); }

export function getIsChartGenerating() { return _activeState?.isChartGenerating || false; }
export function setIsChartGenerating(v) { _activeState.isChartGenerating = v; persistTabState(); }

export function getDetectedCharts() { return _activeState?.detectedCharts || []; }
export function setDetectedCharts(v) { _activeState.detectedCharts = v; persistTabState(); }
