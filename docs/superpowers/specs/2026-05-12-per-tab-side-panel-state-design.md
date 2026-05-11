# Per-Tab Side Panel State Isolation

**Date:** 2026-05-12
**Status:** Approved

## Problem

The side panel's state (`state.js`) is entirely global — all fields are module-level `let` variables. When the side panel is opened for different tabs, all tabs share the same `_pageContent`, `_conversationHistory`, `_currentChatId`, etc. There is no per-tab isolation.

## Goal

Content-related state follows the tab. Each tab has an independent conversation session with its own page content and chat history. Config/settings (theme, language, quick commands, system prompt) remain global across all tabs.

### State Classification

**Per-tab (isolated):**
`_pageContent`, `_pageTitle`, `_pageExcerpt`, `_conversationHistory`, `_currentChatId`, `_selectedText`, `_isGenerating`, `_isPodcastGenerating`, `_isChartGenerating`, `_detectedCharts`, `_ocrRunning`, `_ocrResults`, `_imageIndex`

**Global (unchanged):**
`_customSystemPrompt`, `_quickCommands`, `_suggestQuestionsEnabled`, `_activeTabId`

### Behavior

- User opens side panel on Tab A → extracts page, chats → switches to Tab B → side panel shows Tab B's independent (or fresh) state
- Switching back to Tab A → restores Tab A's previous conversation and page content
- State persists via `chrome.storage.session` (survives side panel close/reopen, lost on browser restart)
- Closing a tab → its state is cleaned up from storage

## Design — Approach A: `chrome.storage.session` + `tabs.onActivated`

### Architecture

```
┌─────────────────────────────────────┐
│           state.js                   │
│                                      │
│  _tabStates: Map<tabId, TabState>   │  ← memory cache
│  _activeState: TabState | null       │  ← pointer to current tab
│  _activeTabId: number | null         │
│                                      │
│  + getPageContent() → _activeState   │  ← API unchanged
│  + setPageContent(v) → _activeState  │  ← API unchanged
│  + switchToTab(tabId)                │  ← NEW: save/load tab state
│  + persistTabState()                 │  ← NEW: flush to session storage
│  + cleanupTabState(tabId)            │  ← NEW: remove on tab close
└─────────────────────────────────────┘

         │ chrome.storage.session
         │ key: tabState_${tabId}
         │ value: TabState object
         ▼
```

### Data Flow

```
User activates Tab B
  → chrome.tabs.onActivated (main.js)
  → state.persistTabState()          save Tab A to session storage
  → state.switchToTab(newTabId)       load Tab B from session storage
  → state.notify('tabSwitched')       signal UI
  → resetUIForTabSwitch()             clear chat area, render history
  → extractPageContent() if fresh     pull page content for new tab
```

### state.js Changes

**New internal state:**
```javascript
const _tabStates = new Map();  // Map<tabId, TabState>
let _activeState = null;       // pointer to current TabState
let _activeTabId = null;       // current tab id
```

**New functions:**
- `createFreshTabState()` → returns `{pageContent:'', pageTitle:'', pageExcerpt:'', conversationHistory:[], currentChatId:null, selectedText:'', isGenerating:false, isPodcastGenerating:false, isChartGenerating:false, detectedCharts:[], ocrRunning:0, ocrResults:[], imageIndex:0}`
- `persistTabState()` → `chrome.storage.session.set({['tabState_' + _activeTabId]: _activeState})` — fire-and-forget async
- `switchToTab(newTabId)` → persists current, loads new from storage or creates fresh, sets `_activeState` and `_activeTabId`
- `cleanupTabState(tabId)` → removes from `_tabStates` Map and `chrome.storage.session`

**Modified getter/setter pattern (per-tab fields only):**
```javascript
// Before:
export function getPageContent() { return _pageContent; }
export function setPageContent(v) { _pageContent = v; }

// After:
export function getPageContent() { return _activeState?.pageContent || ''; }
export function setPageContent(v) { _activeState.pageContent = v; persistTabState(); }
// persistTabState() is fire-and-forget — no await needed on individual setters
```

Global fields (`_customSystemPrompt`, `_quickCommands`, `_suggestQuestionsEnabled`) remain as plain module-level variables — no change.

**initState() updated:**
```javascript
export async function initState() {
  // Load global config from sync storage (unchanged)
  const data = await chrome.storage.sync.get(['systemPrompt']);
  if (data.systemPrompt) setCustomSystemPrompt(data.systemPrompt);
  const sync = await chrome.storage.sync.get(['suggestQuestions']);
  if (sync.suggestQuestions !== undefined) setSuggestQuestionsEnabled(sync.suggestQuestions);
  const local = await chrome.storage.local.get(['quickCommands']);
  if (local.quickCommands) setQuickCommands(local.quickCommands);

  // Determine active tab and load its state from session storage
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    const tabId = tabs[0].id;
    _activeTabId = tabId;
    const stored = await chrome.storage.session.get(`tabState_${tabId}`);
    _activeState = stored[`tabState_${tabId}`] || createFreshTabState();
    _tabStates.set(tabId, _activeState);
  }
}
```

**Subscriptions:**
- Add `subscribe('tabSwitched', fn)` / `notify('tabSwitched')` pattern
- `isGenerating` subscription continues as-is (per-tab state, already notifies)

### main.js Changes

**New: `tabs.onActivated` listener** (added in `bindGlobalEvents`):
```javascript
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (activeInfo.tabId === state.getActiveTabId()) return;

  state.setIsGenerating(false);
  state.setIsPodcastGenerating(false);
  state.setIsChartGenerating(false);
  if (isTTSPlaying()) stopTTS();

  await state.switchToTab(activeInfo.tabId);
  resetUIForTabSwitch();
});
```

**New: `resetUIForTabSwitch()` function:**
```javascript
function resetUIForTabSwitch() {
  removeSuggestQuestions();
  clearImagePreviews();
  updateQuotePreview('');

  const history = state.getConversationHistory();
  els.chatArea.innerHTML = '';

  if (history.length > 0) {
    for (const msg of history) {
      if (msg.role === 'user') appendMessage('user', msg.content);
      else if (msg.role === 'assistant') appendMessage('ai', msg.content);
    }
  } else {
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  }
}
```

### ai-chat.js Changes

**Fix `extractPageContent()`** — use stored tabId instead of querying active tab:
```javascript
// Before:
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

// After:
const tabId = state.getActiveTabId();
if (!tabId) throw new Error(t('error.noTab'));
const response = await chrome.tabs.sendMessage(tabId, { action: 'extract' });
```

### manifest.json Change

Add `"tabs"` permission:
```json
"permissions": ["sidePanel", "storage", "activeTab", "scripting", "contextMenus", "tabs"]
```

### Tab Cleanup

In `state.js`, add listener:
```javascript
chrome.tabs.onRemoved.addListener((tabId) => {
  _tabStates.delete(tabId);
  chrome.storage.session.remove(`tabState_${tabId}`);
  if (tabId === _activeTabId) {
    _activeState = null;
    _activeTabId = null;
    notify('tabClosed');
  }
});
```

## Files Affected

| File | Change | Lines |
|------|--------|-------|
| `public/manifest.json` | Add `"tabs"` permission | +1 |
| `src/side_panel/state.js` | Core refactor: Map, session storage, switchToTab, cleanup | ~+80 |
| `src/side_panel/main.js` | `tabs.onActivated` listener, `resetUIForTabSwitch` | ~+45 |
| `src/side_panel/services/ai-chat.js` | `extractPageContent` uses `getActiveTabId()` | ~5 changed |
| All other files | No changes (getter/setter API unchanged) | 0 |

## Edge Cases

1. **Tab closed while being the active side-panel tab** → `tabs.onRemoved` cleans up; `_activeState` set to null; next tab activation loads fresh
2. **Side panel closed and reopened** → `chrome.storage.session` preserves state; `initState()` loads from storage
3. **Tab refreshed/reloaded while side panel is open for it** → page content may become stale; user can manually send a new message to trigger re-extraction
4. **Multiple windows** → `tabs.onActivated` includes `windowId`; handled correctly since tab IDs are globally unique
5. **Cross-window tab activation** → same `tabs.onActivated` handler fires; current window's side panel detects the switch
6. **Generation in progress on tab switch** → `setIsGenerating(false)` + port disconnect callback handles UI cleanup; any in-flight messages write to old persisted state harmlessly
7. **First-ever visit to a tab** → `switchToTab` creates fresh `TabState`; UI shows welcome message; automatic extraction on next user action
8. **Retry on restored messages** → `resetUIForTabSwitch` renders messages via `appendMessage`, which does not set `dataset.rawText` / `rawDisplay` / `rawQuote`. The retry button is present but non-functional for restored history messages. Acceptable — restored messages represent a completed past conversation; retrying individual messages from a previous session is an uncommon workflow.
