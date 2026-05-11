# Per-Tab Side Panel State Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate content-related side panel state per tab using `chrome.storage.session` + `tabs.onActivated` listener. Switch tabs in Chrome and the side panel loads the correct independent conversation and page content for each tab.

**Architecture:** `state.js` gains a `Map<tabId, TabState>` internal cache. All per-tab getters/setters point to `_activeState` (the current tab's state object). `main.js` listens for `chrome.tabs.onActivated` and calls `state.switchToTab()` to save/load per-tab state. `chrome.storage.session` provides persistence across side panel close/reopen.

**Tech Stack:** Vanilla JS (no framework), Chrome Extension Manifest V3 APIs (`storage.session`, `tabs.onActivated`, `tabs.onRemoved`)

---

## Task 1: Add `tabs` permission to manifest

**Files:**
- Modify: `public/manifest.json`

- [ ] **Step 1: Add `"tabs"` to the permissions array**

In `public/manifest.json`, the permissions array currently reads:
```json
"permissions": ["sidePanel", "storage", "activeTab", "scripting", "contextMenus"],
```

Change to:
```json
"permissions": ["sidePanel", "storage", "activeTab", "scripting", "contextMenus", "tabs"],
```

- [ ] **Step 2: Verify the change**

Run: `cat public/manifest.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('tabs' in d['permissions'])"`
Expected: `True`

- [ ] **Step 3: Commit**

```bash
git add public/manifest.json
git commit -m "chore: add tabs permission for per-tab state isolation"
```

---

## Task 2: Refactor state.js — per-tab state with Map and session storage

**Files:**
- Modify: `src/side_panel/state.js` (full rewrite of internal structure)

**Current file** (`src/side_panel/state.js`) has 100 lines. The per-tab state fields are module-level `let` variables. The `subscribe`/`notify` pattern exists at the top. The `initState()` function reads from `chrome.storage.sync` and `chrome.storage.local`, and queries `chrome.tabs.query` for `_activeTabId`.

**All changes are within `state.js` only. No imports or exports change their names.** Consumers continue to call the same `getPageContent()`, `setPageContent(v)`, etc.

- [ ] **Step 1: Replace the entire file with the per-tab state version**

Write `src/side_panel/state.js`:

```javascript
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
export function setIsGenerating(v) { _activeState.isGenerating = v; notify('isGenerating', v); }

export function getCurrentChatId() { return _activeState?.currentChatId || null; }
export function setCurrentChatId(v) { _activeState.currentChatId = v; persistTabState(); }

export function getSelectedText() { return _activeState?.selectedText || ''; }
export function setSelectedText(v) { _activeState.selectedText = v; }

export function getOcrRunning() { return _activeState?.ocrRunning || 0; }
export function setOcrRunning(v) { _activeState.ocrRunning = v; }

export function getOcrResults() { return _activeState?.ocrResults || []; }
export function setOcrResults(v) { _activeState.ocrResults = v; }

export function getImageIndex() { return _activeState?.imageIndex || 0; }
export function setImageIndex(v) { _activeState.imageIndex = v; }

export function getIsPodcastGenerating() { return _activeState?.isPodcastGenerating || false; }
export function setIsPodcastGenerating(v) { _activeState.isPodcastGenerating = v; }

export function getIsChartGenerating() { return _activeState?.isChartGenerating || false; }
export function setIsChartGenerating(v) { _activeState.isChartGenerating = v; }

export function getDetectedCharts() { return _activeState?.detectedCharts || []; }
export function setDetectedCharts(v) { _activeState.detectedCharts = v; }
```

- [ ] **Step 2: Verify the file is syntactically valid**

Run: `node --check src/side_panel/state.js`
Expected: No output (exits 0)

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/state.js
git commit -m "refactor: per-tab state isolation with Map and chrome.storage.session"
```

---

## Task 3: Add tab activation listener and UI reset in main.js

**Files:**
- Modify: `src/side_panel/main.js`

**Current state of `main.js`** (235 lines): `init()` calls `initState()` at line 44, then initializes all layers. `bindGlobalEvents()` at lines 150-221 sets up button handlers, `chrome.runtime.onMessage`, and `chrome.storage.onChanged`. There is no `chrome.tabs.onActivated` listener. The `newChatBtn` handler (lines 153-173) does a UI reset that is almost exactly what `resetUIForTabSwitch` needs — it is the reference implementation.

- [ ] **Step 1: Add `resetUIForTabSwitch` function**

Insert **after** the `handleLoadChat` function (which ends at line 148), before `bindGlobalEvents`:

```javascript
function resetUIForTabSwitch() {
  removeSuggestQuestions();
  clearImagePreviews();
  updateQuotePreview('');

  const history = state.getConversationHistory();
  els.chatArea.innerHTML = '';

  if (history.length > 0) {
    for (const msg of history) {
      if (msg.role === 'user') {
        appendMessage('user', msg.content);
      } else if (msg.role === 'assistant') {
        appendMessage('ai', msg.content);
      }
    }
  } else {
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  }
}
```

- [ ] **Step 2: Add `tabs.onActivated` listener inside `bindGlobalEvents`**

Inside `bindGlobalEvents()`, add the listener **after** the `quoteClose` click handler (line 195) and **before** `chrome.runtime.onMessage.addListener` (line 197):

```javascript
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (activeInfo.tabId === state.getActiveTabId()) return;

    // Cancel active generations
    state.setIsGenerating(false);
    state.setIsPodcastGenerating(false);
    state.setIsChartGenerating(false);
    if (isTTSPlaying()) stopTTS();

    await state.switchToTab(activeInfo.tabId);
    resetUIForTabSwitch();
  });
```

- [ ] **Step 3: Verify syntax**

Run: `node --check src/side_panel/main.js`
Expected: No output (exits 0)

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/main.js
git commit -m "feat: add tab activation listener with per-tab UI reset"
```

---

## Task 4: Fix extractPageContent in ai-chat.js to use stored tab ID

**Files:**
- Modify: `src/side_panel/services/ai-chat.js`

**Current code** at lines 113-128:
```javascript
export async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error(t('error.noTab'));
  state.setActiveTabId(tab.id);

  const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
  if (!response?.success) {
    throw new Error(response?.error || t('error.extractFailed'));
  }

  state.setPageContent(response.data.textContent);
  state.setPageExcerpt(response.data.excerpt);
  state.setPageTitle(response.data.title);

  return response.data;
}
```

- [ ] **Step 1: Replace `extractPageContent` to use `state.getActiveTabId()`**

Replace lines 113-128 with:

```javascript
export async function extractPageContent() {
  const tabId = state.getActiveTabId();
  if (!tabId) throw new Error(t('error.noTab'));

  const response = await chrome.tabs.sendMessage(tabId, { action: 'extract' });
  if (!response?.success) {
    throw new Error(response?.error || t('error.extractFailed'));
  }

  state.setPageContent(response.data.textContent);
  state.setPageExcerpt(response.data.excerpt);
  state.setPageTitle(response.data.title);

  return response.data;
}
```

Note: `state.setActiveTabId(tab.id)` is removed — `_activeTabId` is now managed internally by `state.js` via `initState()` and `switchToTab()`.

- [ ] **Step 2: Verify syntax**

Run: `node --check src/side_panel/services/ai-chat.js`
Expected: No output (exits 0)

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/services/ai-chat.js
git commit -m "fix: extractPageContent uses stored activeTabId instead of querying"
```

---

## Task 5: Build and verify

- [ ] **Step 1: Run full production build**

Run: `npm run build`
Expected: Build completes without errors. The `dist/` directory contains updated bundles.

- [ ] **Step 2: Check dist output files exist**

Run: `ls dist/src/side_panel/`
Expected: `index.html` and related JS bundles exist.

Run: `ls dist/content.js dist/background.js`
Expected: Both files exist.

- [ ] **Step 3: Verify manifest in dist has `tabs` permission**

Run: `python3 -c "import json; d=json.load(open('dist/manifest.json')); print('tabs' in d['permissions'])"`
Expected: `True`

- [ ] **Step 4: Commit (if build produced any changes to dist that need tracking)**

```bash
git add dist/ && git commit -m "build: production build with per-tab state changes" || echo "dist changes already committed"
```

---

## Manual Verification Checklist

After loading `dist/` in `chrome://extensions/`:

1. Open side panel on Tab A, extract page content, send a chat message — verify conversation appears
2. Switch to Tab B — verify side panel shows welcome message (clean state)
3. Switch back to Tab A — verify previous conversation is restored
4. On Tab B, extract page content and send a message — verify Tab B has independent conversation
5. Switch between Tab A and Tab B — verify each shows its own conversation
6. Close side panel entirely, reopen on Tab A — verify conversation still there (session storage persistence)
7. Close Tab A in the browser — verify Tab B side panel still works
8. TTS, podcast, chart features — verify they work correctly on each tab independently
