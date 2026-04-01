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

// --- State fields (getter/setter pairs) ---

let _pageContent = '';
export function getPageContent() { return _pageContent; }
export function setPageContent(v) { _pageContent = v; }

let _pageExcerpt = '';
export function getPageExcerpt() { return _pageExcerpt; }
export function setPageExcerpt(v) { _pageExcerpt = v; }

let _pageTitle = '';
export function getPageTitle() { return _pageTitle; }
export function setPageTitle(v) { _pageTitle = v; }

let _conversationHistory = [];
export function getConversationHistory() { return _conversationHistory; }
export function setConversationHistory(v) { _conversationHistory = v; }
export function pushConversation(msg) { _conversationHistory.push(msg); }
export function spliceConversation(...args) { _conversationHistory.splice(...args); }
export function clearConversation() { _conversationHistory = []; }

let _isGenerating = false;
export function getIsGenerating() { return _isGenerating; }
export function setIsGenerating(v) { _isGenerating = v; notify('isGenerating', v); }

let _customSystemPrompt = '';
export function getCustomSystemPrompt() { return _customSystemPrompt; }
export function setCustomSystemPrompt(v) { _customSystemPrompt = v; }

let _currentChatId = null;
export function getCurrentChatId() { return _currentChatId; }
export function setCurrentChatId(v) { _currentChatId = v; }

let _selectedText = '';
export function getSelectedText() { return _selectedText; }
export function setSelectedText(v) { _selectedText = v; }

let _activeTabId = null;
export function getActiveTabId() { return _activeTabId; }
export function setActiveTabId(v) { _activeTabId = v; }

let _ocrRunning = 0;
export function getOcrRunning() { return _ocrRunning; }
export function setOcrRunning(v) { _ocrRunning = v; }

let _ocrResults = [];
export function getOcrResults() { return _ocrResults; }
export function setOcrResults(v) { _ocrResults = v; }

let _imageIndex = 0;
export function getImageIndex() { return _imageIndex; }
export function setImageIndex(v) { _imageIndex = v; }

let _quickCommands = [];
export function getQuickCommands() { return _quickCommands; }
export function setQuickCommands(v) { _quickCommands = v; }

let _suggestQuestionsEnabled = true;
export function isSuggestQuestionsEnabled() { return _suggestQuestionsEnabled; }
export function setSuggestQuestionsEnabled(v) { _suggestQuestionsEnabled = v; }

// --- Async init: read chrome.storage ---
export async function initState() {
  const data = await chrome.storage.sync.get(['systemPrompt']);
  if (data.systemPrompt) setCustomSystemPrompt(data.systemPrompt);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) setActiveTabId(tabs[0].id);

  const local = await chrome.storage.local.get(['quickCommands']);
  if (local.quickCommands) setQuickCommands(local.quickCommands);

  const sync = await chrome.storage.sync.get(['suggestQuestions']);
  if (sync.suggestQuestions !== undefined) setSuggestQuestionsEnabled(sync.suggestQuestions);
}
