# Vite 模块化重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate a Chrome Extension (MV3) from 14 global-scope `<script>` tags to Vite + ES Modules with layered architecture, eliminating load-order fragility and circular dependencies.

**Architecture:** 5-layer dependency hierarchy (shared → state → ui → services → features) with a main.js entry point that wires modules together via callback injection. Content script and service worker built as IIFE bundles; side_panel and options built as standard Vite HTML entries.

**Tech Stack:** Vite 6, npm, ES Modules, JavaScript (no TypeScript), Chrome Extension Manifest V3

**Spec:** `docs/superpowers/specs/2026-04-01-vite-modularization-design.md`

---

## File Map

### New files (created from existing sources)

| Source | Destination | Responsibility |
|---|---|---|
| `i18n.js` | `src/shared/i18n.js` | Internationalization (add `export`) |
| (new) | `src/shared/constants.js` | `TRUNCATE_LIMITS`, `safeTruncate`, `escapeHtml` |
| (new) | `src/side_panel/state.js` | Central state: 14 getter/setter pairs + subscribe |
| `side_panel/ui-helpers.js` | `src/side_panel/ui/dom-helpers.js` | DOM helpers (remove ai-chat dependency) |
| `side_panel/theme.js` | `src/side_panel/ui/theme.js` | Theme toggle |
| `side_panel/model-status.js` | `src/side_panel/ui/model-status.js` | Model status bar |
| `side_panel/tts-streaming.js` | `src/side_panel/services/tts.js` | TTS logic |
| `side_panel/ocr.js` | `src/side_panel/services/ocr.js` | OCR logic |
| `side_panel/ai-chat.js` + `side_panel/side_panel.js` | `src/side_panel/services/ai-chat.js` | AI chat + event binding from side_panel.js |
| `side_panel/chat-history.js` | `src/side_panel/features/chat-history.js` | Chat history |
| `side_panel/quick-commands.js` | `src/side_panel/features/quick-commands.js` | Quick commands |
| `side_panel/suggest-questions.js` | `src/side_panel/features/suggest-questions.js` | Suggest questions |
| `side_panel/outline.js` | `src/side_panel/features/outline.js` | Outline generation |
| `side_panel/image-input.js` | `src/side_panel/features/image-input.js` | Image paste/drop |
| (new) | `src/side_panel/main.js` | Entry: init all modules, wire callbacks, bind events |
| `side_panel/side_panel.html` | `src/side_panel/index.html` | Side panel HTML (single `<script type="module">`) |
| `side_panel/*.css` | `src/side_panel/*.css` | Stylesheets (moved as-is) |
| `content.js` | `src/content/index.js` | Content script |
| `service_worker.js` | `src/background/service-worker.js` | Service worker |
| `options/options.js` | `src/options/index.js` | Options page logic |
| `options/options.html` | `src/options/index.html` | Options HTML |
| `options/options.css` | `src/options/options.css` | Options styles |
| (new) | `vite.config.js` | Vite build config |
| (new) | `package.json` | npm project |
| `manifest.json` | `public/manifest.json` | Extension manifest (paths updated) |
| `icons/*` | `public/icons/*` | Extension icons (moved) |

### Files deleted after migration

All original files at project root and in `side_panel/`, `options/` directories (after confirming the build works).

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `public/manifest.json` (copy from `manifest.json`, update paths)
- Move: `icons/` → `public/icons/`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "chrome-ai-reader",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build"
  },
  "devDependencies": {
    "vite": "^6.0.0"
  },
  "dependencies": {
    "marked": "^15.0.0",
    "@mozilla/readability": "^0.5.0"
  }
}
```

- [ ] **Step 2: Create vite.config.js**

This project has 4 contexts. HTML entries (side_panel, options) use standard Vite. JS entries (content, background) need IIFE format.

This project has 4 contexts with different build needs. We use a **multi-step build**: Vite handles the two HTML entries (side_panel, options), then a separate Rollup step bundles the two JS-only entries (content script, service worker) as IIFE. Chrome content scripts do NOT support ES modules — they must be self-contained IIFE files. The service worker also needs a single file to avoid manifest path issues.

```js
// vite.config.js — handles HTML entries only
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: 'inline',
    rollupOptions: {
      input: {
        side_panel: resolve(__dirname, 'src/side_panel/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
      },
    },
  },
});
```

Then `build-extension.js` handles the JS-only entries:

```js
// build-extension.js — bundles content script and service worker as IIFE
import { rollup } from 'rollup';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildIIFE(entry, name) {
  const bundle = await rollup({ input: resolve(__dirname, entry) });
  await bundle.write({
    file: resolve(__dirname, `dist/${name}.js`),
    format: 'iife',
    sourcemap: 'inline',
  });
  await bundle.close();
}

await buildIIFE('src/content/index.js', 'content');
await buildIFFE('src/background/service-worker.js', 'background');
console.log('IIFE bundles written to dist/');
```

Update `package.json` scripts:
```json
{
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build && node build-extension.js"
  }
}
```

**Development workflow:** After `npm run dev`, changes to side_panel/options files trigger auto-rebuild. For content/background changes, run `node build-extension.js` manually or restart the dev command. Then reload the extension in `chrome://extensions` (HMR does not work in Chrome extension contexts).

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 4: Move icons and create public manifest**

Copy `icons/` to `public/icons/` and create `public/manifest.json`. The manifest paths must match Vite's output structure. Since Vite preserves `src/` directory structure for HTML entries, and we configure JS entries to output at root:

```json
{
  "manifest_version": 3,
  "name": "__MSG_app_title__",
  "version": "1.0",
  "description": "__MSG_app_description__",
  "default_locale": "zh",
  "permissions": ["activeTab", "sidePanel", "scripting", "storage"],
  "action": { "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" } },
  "side_panel": { "default_path": "src/side_panel/index.html" },
  "options_page": "src/options/index.html",
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"] }],
  "background": { "service_worker": "background.js" },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

Copy the remaining fields from the original `manifest.json` (content_scripts CSS, web_accessible_resources, etc.).

- [ ] **Step 5: Install dependencies**

Run: `npm install`

- [ ] **Step 6: Create empty src directory structure**

```
src/
  shared/
  side_panel/
    ui/
    services/
    features/
  content/
  background/
  options/
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize Vite project scaffolding"
```

---

## Task 2: Shared Modules

**Files:**
- Create: `src/shared/i18n.js` (from `i18n.js`)
- Create: `src/shared/constants.js` (extract from `side_panel/side_panel.js` + `side_panel/ui-helpers.js`)

- [ ] **Step 1: Convert i18n.js to ES module**

Copy `i18n.js` to `src/shared/i18n.js`. Add `export` to all public functions. Change `let currentLang` to be accessed via getter only (let variables can only be reassigned in their defining module):

Key changes:
- Add `export` to: `t`, `loadLanguage`, `setLanguage`, `applyTranslations`
- Add `export function getCurrentLang() { return currentLang; }`
- Remove `export` from `TRANSLATIONS` (internal only)
- Keep `currentLang` as `let` (only settable within i18n.js via `setLanguage`)

The file is 384 lines — copy it verbatim and add `export` keywords to the 5 public functions.

- [ ] **Step 2: Create constants.js**

Extract from `side_panel/side_panel.js` (TRUNCATE_LIMITS, safeTruncate) and `side_panel/ui-helpers.js` (escapeHtml):

```js
// src/shared/constants.js
import { t } from './i18n.js';

export const TRUNCATE_LIMITS = {
  CONTEXT: 64000,
  QUOTE: 64000,
};

export function safeTruncate(text, maxLen, suffix) {
  if (!text) return text;
  const chars = [...text];
  if (chars.length <= maxLen) return text;
  const truncSuffix = suffix || t('ai.truncated');
  const truncated = chars.slice(0, maxLen).join('');
  const lookback = Math.min(200, maxLen);
  const tail = truncated.slice(-lookback);
  const lastBreak = tail.lastIndexOf('\n');
  if (lastBreak > 0) {
    return truncated.slice(0, truncated.length - lookback + lastBreak + 1) + truncSuffix;
  }
  return truncated + truncSuffix;
}

// Preserved from ui-helpers.js — DOM-based implementation handles all HTML entities correctly
export function escapeHtml(text) {
  if (!text) return text;
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**Important:** `safeTruncate` calls `t('ai.truncated')` for the truncation suffix (supports i18n) — this creates a dependency on `i18n.js`, which is fine since both are in `shared/`. The DOM-based `escapeHtml` is preserved from the original `ui-helpers.js` (more robust than regex for arbitrary web content).

- [ ] **Step 3: Commit**

```bash
git add src/shared/
git commit -m "feat: create shared modules (i18n, constants)"
```

---

## Task 3: State Management

**Files:**
- Create: `src/side_panel/state.js`

- [ ] **Step 1: Create state.js**

This module centralizes all mutable state from `side_panel/side_panel.js` with getter/setter pairs and a pub-sub mechanism. Read the current `side_panel/side_panel.js` lines 19-27 for the original variable declarations.

```js
// src/side_panel/state.js
import { safeTruncate } from '../shared/constants.js';

const listeners = new Map();

export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => listeners.get(key)?.delete(callback);
}

function notify(key, value) {
  listeners.get(key)?.forEach(cb => cb(value));
}

// --- State fields ---

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
```

- [ ] **Step 2: Commit**

```bash
git add src/side_panel/state.js
git commit -m "feat: create centralized state management module"
```

---

## Task 4: UI Layer

**Files:**
- Create: `src/side_panel/ui/dom-helpers.js` (from `side_panel/ui-helpers.js`)
- Create: `src/side_panel/ui/theme.js` (from `side_panel/theme.js`)
- Create: `src/side_panel/ui/model-status.js` (from `side_panel/model-status.js`)

- [ ] **Step 1: Convert dom-helpers.js**

Copy `side_panel/ui-helpers.js` to `src/side_panel/ui/dom-helpers.js`. Key changes:

1. Add imports at top:
```js
import { escapeHtml } from '../../shared/constants.js';
import { marked } from 'marked';
```

2. Remove the local `escapeHtml` function definition (now imported from constants.js)

3. Remove `var chatArea = document.getElementById('chatArea')` etc. — accept DOM references via function parameters instead. Add a module-level `_refs` object set during init:
```js
let _chatArea, _actionBtns, _sendBtn;

export function initDOMHelpers({ chatArea, actionBtns, sendBtn }) {
  _chatArea = chatArea;
  _actionBtns = actionBtns;
  _sendBtn = sendBtn;
}
```

4. Replace all `chatArea` references with `_chatArea`, `actionBtns` with `_actionBtns`, `sendBtn` with `_sendBtn`.

5. **Break circular dependency with ai-chat:** The `addUserActions` function currently calls `retryMessage()` (defined in ai-chat.js). Change it to accept a callbacks object:
```js
export function addUserActions(wrapper, msgEl, callbacks) {
  // ...
  // In retry button onclick: callbacks.onRetry(wrapper, msgEl.dataset.rawText, ...)
}
```

6. Add `export` to all functions.

- [ ] **Step 2: Convert theme.js**

Copy `side_panel/theme.js` to `src/side_panel/ui/theme.js`. It's already self-contained (41 lines). Add `export` to `applyTheme`. Add an `initTheme` function that sets up the toggle button and reads initial state from storage:

```js
import { t } from '../../shared/i18n.js';

export function applyTheme(dark, themeName) { /* existing code */ }

export async function initTheme() {
  const data = await chrome.storage.sync.get(['darkMode', 'themeName']);
  applyTheme(data.darkMode, data.themeName || 'sujian');
  // Set up toggle button listener
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.addEventListener('click', toggleDarkMode);
}

async function toggleDarkMode() {
  const data = await chrome.storage.sync.get('darkMode');
  const newDark = !data.darkMode;
  await chrome.storage.sync.set({ darkMode: newDark });
  // applyTheme will be triggered by storage.onChanged
}
```

Keep the existing `chrome.storage.onChanged` listener for cross-tab sync.

- [ ] **Step 3: Convert model-status.js**

Copy `side_panel/model-status.js` to `src/side_panel/ui/model-status.js`. Add imports and exports:

```js
import { t } from '../../shared/i18n.js';

export function updateModelStatusBar(name) { /* existing code */ }
export function initModelStatus() {
  chrome.storage.sync.get('modelName', (data) => {
    if (data.modelName) updateModelStatusBar(data.modelName);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.modelName) updateModelStatusBar(changes.modelName.newValue);
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/ui/
git commit -m "feat: convert UI layer to ES modules"
```

---

## Task 5: Services Layer

**Files:**
- Create: `src/side_panel/services/tts.js` (from `side_panel/tts-streaming.js`)
- Create: `src/side_panel/services/ocr.js` (from `side_panel/ocr.js`)
- Create: `src/side_panel/services/ai-chat.js` (from `side_panel/ai-chat.js`)

- [ ] **Step 1: Convert tts.js**

Copy `side_panel/tts-streaming.js` (385 lines) to `src/side_panel/services/tts.js`. Key changes:

1. Add imports:
```js
import { t } from '../../shared/i18n.js';
```

2. Replace global `chatArea` with module-level ref set in init:
```js
let _chatArea;
export function initTTS({ chatArea }) { _chatArea = chatArea; /* existing init code */ }
```

3. Add state getters for cross-module access:
```js
export function isTTSPlaying() { return ttsPlaying; }
export function isTTSAutoPlay() { return ttsAutoPlayEnabled; }
```

4. Add `export` to: `stopTTS`, `initTTSPlayback`, `ttsAppendChunk`, `ttsFlushRemaining`, `handleTTSButtonClick`, `addTTSButton`, `initTTSAutoPlay`, `ttsEnqueue`.

5. Keep internal functions private: `stripMarkdown`, `splitToSegments`, `ttsFlushRemaining`.

- [ ] **Step 2: Convert ocr.js**

Copy `side_panel/ocr.js` (130 lines) to `src/side_panel/services/ocr.js`. Key changes:

1. Add imports:
```js
import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
```

2. Replace global `ocrResults`, `ocrRunning`, `imageIndex` with state getters/setters:
```js
// Before: ocrResults.push(...)
// After:  state.getOcrResults().push(...)
// Before: ocrRunning++
// After:  state.setOcrRunning(state.getOcrRunning() + 1)
// Before: imageIndex++
// After:  state.setImageIndex(state.getImageIndex() + 1)
```

3. Add `export` to: `addImagePreview`, `runOCR`, `collectImageDataUris`, `clearImagePreviews`, `buildOcrContext`, `hasImageErrors`, `extractOcrText`.

4. Add `export function initOCR() {}` that sets up event listeners (image upload button, file input).

- [ ] **Step 3: Convert ai-chat.js**

This is the most complex conversion. Merge logic from both `side_panel/ai-chat.js` (268 lines) and the event-binding parts of `side_panel/side_panel.js` (214 lines). Key changes:

1. Add imports (services layer depends on shared, state, ui — NOT on features):
```js
import { t } from '../../shared/i18n.js';
import { TRUNCATE_LIMITS } from '../../shared/constants.js';
import * as state from '../state.js';
import { appendMessage, appendMessageWithQuote, addTypingIndicator, removeTypingIndicator, removeLastMessage, smartScrollToBottom, setButtonsDisabled } from '../ui/dom-helpers.js';
import { isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk, addTTSButton, initTTSAutoPlay, isTTSAutoPlay } from './tts.js';
import { getOcrRunning, hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews } from './ocr.js';
import { marked } from 'marked';
```

**Important:** ai-chat.js does NOT import from `features/` (that would violate the layer hierarchy: services → features is a downward dependency). Instead, `removeSuggestQuestions` and `generateSuggestions` from `features/suggest-questions.js` are injected via the init callback:

```js
let _onRemoveSuggestQuestions;
let _onGenerateSuggestions;

export function initAIChat({ chatArea, userInput, sendBtn, actionBtns, callbacks }) {
  // ...
  _onRemoveSuggestQuestions = callbacks.onRemoveSuggestQuestions;
  _onGenerateSuggestions = callbacks.onGenerateSuggestions;
}
```

In `callAI`'s `done` handler, replace `removeSuggestQuestions()` with `_onRemoveSuggestQuestions?.()` and `generateSuggestions(msgEl, ...)` with `_onGenerateSuggestions?.(msgEl, ...)`.
```js
// Before: isGenerating = true;
// After:  state.setIsGenerating(true);
// Before: conversationHistory.push(...)
// After:  state.pushConversation(...)
// Before: pageContent = response.data.textContent;
// After:  state.setPageContent(response.data.textContent);
```

3. The `initAIChat` function receives DOM refs and sets up event bindings that were in `side_panel/side_panel.js`:
```js
let _chatArea, _userInput, _sendBtn, _actionBtns;
let _callbacks = {};

export function initAIChat({ chatArea, userInput, sendBtn, actionBtns, callbacks }) {
  _chatArea = chatArea;
  _userInput = userInput;
  _sendBtn = sendBtn;
  _actionBtns = actionBtns;
  _callbacks = callbacks;

  // Event bindings from side_panel.js
  sendBtn.addEventListener('click', sendMessage);
  userInput.addEventListener('keydown', handleKeydown);
  // ... actionBtns click handlers etc.
}
```

4. Add `export` to: `extractPageContent`, `handleQuickAction`, `sendToAI`, `sendMessage`, `retryMessage`.

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/services/
git commit -m "feat: convert services layer to ES modules"
```

---

## Task 6: Features Layer

**Files:**
- Create: `src/side_panel/features/chat-history.js` (from `side_panel/chat-history.js`)
- Create: `src/side_panel/features/quick-commands.js` (from `side_panel/quick-commands.js`)
- Create: `src/side_panel/features/suggest-questions.js` (from `side_panel/suggest-questions.js`)
- Create: `src/side_panel/features/outline.js` (from `side_panel/outline.js`)
- Create: `src/side_panel/features/image-input.js` (from `side_panel/image-input.js`)

- [ ] **Step 1: Convert chat-history.js**

Copy `side_panel/chat-history.js` (270 lines). Key changes:

1. Add imports:
```js
import { t, getCurrentLang } from '../../shared/i18n.js';
import { marked } from 'marked';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
import { scrollToBottom } from '../ui/dom-helpers.js';
```

Note: `escapeHtml` comes from `shared/constants.js` (not `dom-helpers.js`), since that's where it's defined in the new architecture. `scrollToBottom` stays in `dom-helpers.js` since it's a DOM operation.

2. Replace globals with state getters. Replace `historyPanel`/`historyList` with init-injected refs.

3. The `renderOutlineFromJSON` and `outlineToMarkdown` calls to outline.js — receive these via init callback:
```js
let _onRenderOutline, _onOutlineToMarkdown;

export function initChatHistory({ chatArea, historyPanel, historyList, onLoadChat, onRenderOutline, onOutlineToMarkdown }) {
  _chatArea = chatArea;
  _historyPanel = historyPanel;
  _historyList = historyList;
  _onLoadChat = onLoadChat;
  _onRenderOutline = onRenderOutline;
  _onOutlineToMarkdown = onOutlineToMarkdown;
}
```

- [ ] **Step 2: Convert quick-commands.js**

Copy `side_panel/quick-commands.js` (96 lines). Key changes:

1. Add imports:
```js
import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
```

2. Replace `isGenerating` with `state.getIsGenerating()`.

3. The `executeQuickCommand` function currently calls `sendToAI` — change to accept it via init. Also the module needs the `commandPopup` DOM element and document-level click listener for outside-click dismissal:
```js
let _sendToAI, _userInput, _commandPopup;
export function initQuickCommands({ userInput, commandPopup, onSendToAI }) {
  _userInput = userInput;
  _commandPopup = commandPopup;
  _sendToAI = onSendToAI;

  // Outside-click dismissal of command popup
  document.addEventListener('click', (e) => {
    if (_commandPopupOpen && !_commandPopup.contains(e.target) && e.target !== _userInput) {
      hideCommandPopup();
    }
  });
}
```

4. In `main.js`, pass the `commandPopup` element:
```js
initQuickCommands({
  userInput: els.userInput,
  commandPopup: document.getElementById('commandPopup'),
  onSendToAI: sendToAI,
});
```

4. Add `export` to: `isCommandPopupOpen`, `getFilteredCommands`, `updateCommandPopup`, `renderCommandPopup`, `hideCommandPopup`.

- [ ] **Step 3: Convert suggest-questions.js**

Copy `side_panel/suggest-questions.js` (113 lines). Key changes:

1. Add imports:
```js
import { t } from '../../shared/i18n.js';
import * as state from '../state.js';
import { smartScrollToBottom } from '../ui/dom-helpers.js';
```

2. Replace `sendMessage` call with callback:
```js
let _onSend;
export function initSuggestQuestions({ chatArea, userInput, onSend }) {
  _chatArea = chatArea;
  _userInput = userInput;
  _onSend = onSend;
}
```

3. Add `export` to: `removeSuggestQuestions`, `generateSuggestions`.

- [ ] **Step 4: Convert outline.js**

Copy `side_panel/outline.js` (394 lines). This file has the most cross-module dependencies. All are injected via init:

```js
import { t } from '../../shared/i18n.js';
import { marked } from 'marked';
import { TRUNCATE_LIMITS, safeTruncate, escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';

let _deps = {};
export function initOutline(deps) {
  _deps = deps;
}

// Complete dependency list for outline.js (all injected via _deps):
// From services/ai-chat.js:
//   onExtractPageContent  — extractPageContent()
// From services/tts.js:
//   onStopTTS             — stopTTS()
//   onAddTTSButton        — addTTSButton(msgEl)
// From ui/dom-helpers.js:
//   onAppendMessage       — appendMessage(role, content, imageUris, callbacks)
//   onScrollToBottom      — scrollToBottom()
//   onSetButtonsDisabled  — setButtonsDisabled(bool)
// From features/suggest-questions.js:
//   onRemoveSuggestQuestions — removeSuggestQuestions()
// From features/chat-history.js:
//   onSaveCurrentChat     — saveCurrentChat()
// From main.js (DOM refs):
//   chatArea              — DOM element
```

Replace all calls to external functions with `_deps.onXxx()` calls. For state access (`isGenerating`, `pageContent`, `customSystemPrompt`, `conversationHistory`), use `state.getXxx()` / `state.setXxx()` directly — outline.js is in the features layer and may import from state. Export `generateOutline`, `renderOutlineFromJSON`, `outlineToMarkdown`. Remove all `window.xxx =` global assignments (lines 391-393 in original).

- [ ] **Step 5: Convert image-input.js**

Copy `side_panel/image-input.js` (106 lines). It's currently an IIFE. Convert to module:

```js
import { t } from '../../shared/i18n.js';
import { addImagePreview, runOCR } from '../services/ocr.js';
import * as state from '../state.js';

export function initImageInput({ userInput, imagePreviewBar }) {
  // All existing IIFE code goes here, using the injected refs
}
```

- [ ] **Step 6: Commit**

```bash
git add src/side_panel/features/
git commit -m "feat: convert features layer to ES modules"
```

---

## Task 7: Side Panel Entry Point + HTML

**Files:**
- Create: `src/side_panel/main.js`
- Create: `src/side_panel/index.html` (from `side_panel/side_panel.html`)
- Move: `side_panel/*.css` → `src/side_panel/*.css`

- [ ] **Step 1: Move CSS files**

Copy all CSS files from `side_panel/` to `src/side_panel/`:
- `side_panel.css`, `history.css`, `quick-commands.css`, `outline.css`

No changes needed — CSS is pure styling and doesn't depend on JS architecture.

- [ ] **Step 2: Create index.html**

Copy `side_panel/side_panel.html` to `src/side_panel/index.html`. Replace ALL `<script>` tags (14 of them, lines 136-149) with a single entry:

```html
<!-- Replace all 14 <script> tags with this single one -->
<script type="module" src="./main.js"></script>
```

Keep all `<link rel="stylesheet">` tags pointing to CSS files (paths stay the same since CSS files are in the same directory).

- [ ] **Step 3: Create main.js**

This is the orchestration entry point. It initializes all modules in dependency order and wires callbacks to break circular dependencies.

```js
// src/side_panel/main.js
import { loadLanguage, t } from '../shared/i18n.js';
import { marked } from 'marked';
import { initDOMHelpers } from './ui/dom-helpers.js';
import { initTheme } from './ui/theme.js';
import { initModelStatus } from './ui/model-status.js';
import { initState } from './state.js';
import * as state from './state.js';
import { initTTS, isTTSPlaying, stopTTS, addTTSButton, initTTSAutoPlay } from './services/tts.js';
import { initOCR, clearImagePreviews } from './services/ocr.js';
import { initAIChat, sendToAI, sendMessage, retryMessage, handleQuickAction, extractPageContent } from './services/ai-chat.js';
import { initChatHistory, saveCurrentChat, getDisplayMessages, generateTitle, exportChatAsMarkdown, renderHistoryList } from './features/chat-history.js';
import { initQuickCommands, isCommandPopupOpen, updateCommandPopup, hideCommandPopup } from './features/quick-commands.js';
import { initSuggestQuestions, removeSuggestQuestions, generateSuggestions } from './features/suggest-questions.js';
import { initOutline, generateOutline, renderOutlineFromJSON, outlineToMarkdown } from './features/outline.js';
import { initImageInput } from './features/image-input.js';
import { setButtonsDisabled, appendMessage, scrollToBottom } from './ui/dom-helpers.js';

// Configure marked
marked.setOptions({ breaks: true, gfm: true });

// Get DOM refs
const els = {
  chatArea: document.getElementById('chatArea'),
  userInput: document.getElementById('userInput'),
  sendBtn: document.getElementById('sendBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  exportBtn: document.getElementById('exportBtn'),
  historyBtn: document.getElementById('historyBtn'),
  historyPanel: document.getElementById('historyPanel'),
  historyBackBtn: document.getElementById('historyBackBtn'),
  historyList: document.getElementById('historyList'),
  actionBtns: document.querySelectorAll('.action-btn'),
  quotePreview: document.getElementById('quotePreview'),
  quoteText: document.getElementById('quoteText'),
  quoteClose: document.getElementById('quoteClose'),
  imagePreviewBar: document.getElementById('imagePreviewBar'),
};

async function init() {
  // 1. Async inits (parallel)
  await Promise.all([
    loadLanguage(),
    initState(),
    initTheme(),
  ]);

  // 2. UI layer
  initDOMHelpers({
    chatArea: els.chatArea,
    actionBtns: els.actionBtns,
    sendBtn: els.sendBtn,
  });
  initModelStatus();

  // 3. Services
  initTTS({ chatArea: els.chatArea });
  initOCR();

  // 4. Features (wire callbacks to break cycles)
  initChatHistory({
    chatArea: els.chatArea,
    historyPanel: els.historyPanel,
    historyList: els.historyList,
    onLoadChat: handleLoadChat,
    onRenderOutline: renderOutlineFromJSON,
    onOutlineToMarkdown: outlineToMarkdown,
  });
  initQuickCommands({ userInput: els.userInput, onSendToAI: sendToAI });
  initSuggestQuestions({
    chatArea: els.chatArea,
    userInput: els.userInput,
    onSend: sendMessage,
  });
  initOutline({
    onExtractPageContent: extractPageContent,
    onStopTTS: stopTTS,
    onAddTTSButton: addTTSButton,
    onAppendMessage: appendMessage,
    onScrollToBottom: scrollToBottom,
    onSetButtonsDisabled: setButtonsDisabled,
    onRemoveSuggestQuestions: removeSuggestQuestions,
    onSaveCurrentChat: saveCurrentChat,
  });
  initImageInput({
    userInput: els.userInput,
    imagePreviewBar: els.imagePreviewBar,
  });

  // 5. AI chat (last — depends on everything above)
  initAIChat({
    chatArea: els.chatArea,
    userInput: els.userInput,
    sendBtn: els.sendBtn,
    actionBtns: els.actionBtns,
    callbacks: {
      onRetry: retryMessage,
      onRemoveSuggestQuestions: removeSuggestQuestions,
      onGenerateSuggestions: generateSuggestions,
    },
  });

  // 6. Global event bindings (from side_panel.js)
  bindGlobalEvents();
}

function handleLoadChat(chatData) {
  // Update state from loaded chat
  // This was inline in chat-history.js before
}

function bindGlobalEvents() {
  // Settings button
  els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // New chat
  els.newChatBtn.addEventListener('click', () => {
    if (state.getIsGenerating()) return;
    if (isTTSPlaying()) stopTTS();
    saveCurrentChat();
    removeSuggestQuestions();
    state.setPageContent('');
    state.setPageExcerpt('');
    state.setPageTitle('');
    state.clearConversation();
    state.setCurrentChatId(null);
    updateQuotePreview('');
    clearImagePreviews();
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  });

  // Export
  els.exportBtn.addEventListener('click', () => {
    const messages = getDisplayMessages();
    if (messages.length === 0) return;
    exportChatAsMarkdown({
      title: generateTitle(messages),
      messages,
      conversationHistory: state.getConversationHistory(),
      pageTitle: state.getPageTitle(),
    });
  });

  // History panel
  els.historyBtn.addEventListener('click', () => {
    renderHistoryList();
    els.historyPanel.classList.remove('hidden');
  });
  els.historyBackBtn.addEventListener('click', () => {
    els.historyPanel.classList.add('hidden');
  });

  // Action buttons (summarize, translate, keyInfo, outline)
  els.actionBtns.forEach(btn => {
    btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
  });

  // Quote preview
  els.quoteClose.addEventListener('click', () => updateQuotePreview(''));

  // Selection change relay
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'selectionChanged') {
      const tabId = state.getActiveTabId();
      if (tabId && msg.tabId && msg.tabId !== tabId) return;
      updateQuotePreview(msg.text);
    }
  });

  // System prompt sync
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.systemPrompt) {
      state.setCustomSystemPrompt(changes.systemPrompt.newValue || '');
    }
  });

  // Input auto-resize
  els.userInput.addEventListener('input', () => {
    els.userInput.style.height = 'auto';
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 100) + 'px';
    const value = els.userInput.value;
    if (value.startsWith('/')) {
      updateCommandPopup(value);
    } else if (isCommandPopupOpen()) {
      hideCommandPopup();
    }
  });
}

function updateQuotePreview(text) {
  state.setSelectedText(text);
  if (text) {
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    els.quoteText.textContent = truncated;
    els.quotePreview.classList.remove('hidden');
  } else {
    els.quoteText.textContent = '';
    els.quotePreview.classList.add('hidden');
  }
}

init();
```

Note: `main.js` needs imports from `state.js` (using `* as state`) for global event handlers that read/write state directly. Some function references like `updateCommandPopup`, `hideCommandPopup`, `isCommandPopupOpen` come from `features/quick-commands.js` and need explicit imports.

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/
git commit -m "feat: create side_panel entry point with module orchestration"
```

---

## Task 8: Content Script + Service Worker + Options

**Files:**
- Create: `src/content/index.js` (from `content.js`)
- Create: `src/background/service-worker.js` (from `service_worker.js`)
- Create: `src/options/index.js` (from `options/options.js`)
- Create: `src/options/index.html` (from `options/options.html`)
- Move: `options/options.css` → `src/options/options.css`

- [ ] **Step 1: Convert content script**

Copy `content.js` (72 lines) to `src/content/index.js`. Replace the global `Readability` usage with npm import:

```js
import { Readability } from '@mozilla/readability';
```

The rest of the file stays the same — it only uses `chrome.tabs` and `document` APIs, no other project globals.

**Important verification:** `@mozilla/readability` is a CommonJS/UMD package. After building with `node build-extension.js`, check that the output `dist/content.js` contains the Readability code inlined correctly. If the IIFE bundle fails (e.g., Readability expects `window` or has side effects), fall back to keeping `libs/Readability.js` as a separate file in `public/` and loading it before the content script in manifest.json:
```json
"content_scripts": [{ "js": ["libs/Readability.js", "content.js"] }]
```

- [ ] **Step 2: Convert service worker**

Copy `service_worker.js` (350 lines) to `src/background/service-worker.js`. The service worker is self-contained — it doesn't import any other project files. No changes needed except ensuring it's valid standalone JS.

Vite will bundle this as a single file with all imports inlined.

- [ ] **Step 3: Convert options page**

Copy `options/options.js` (506 lines) to `src/options/index.js`. Key changes:

1. Add imports:
```js
import { t, loadLanguage, setLanguage, applyTranslations, getCurrentLang } from '../shared/i18n.js';
import { escapeHtml } from '../shared/constants.js';
```

2. Remove the local `escapeHtml` function (line ~252 in options.js) — now imported from constants.js.

3. Copy `options/options.html` to `src/options/index.html`. Replace the two `<script>` tags:
```html
<!-- Remove these -->
<script src="../i18n.js"></script>
<script src="options.js"></script>
<!-- Add this -->
<script type="module" src="./index.js"></script>
```

4. Copy `options/options.css` to `src/options/options.css`.

- [ ] **Step 4: Commit**

```bash
git add src/content/ src/background/ src/options/
git commit -m "feat: convert content script, service worker, and options to ES modules"
```

---

## Task 9: Build & Verify

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: Build completes with 0 errors. Output in `dist/` directory.

- [ ] **Step 2: Check dist/ structure**

Verify:
- `dist/manifest.json` exists
- `dist/icons/` has icon files
- `dist/src/side_panel/index.html` exists with bundled JS reference
- `dist/src/options/index.html` exists with bundled JS reference
- `dist/content.js` exists (IIFE bundle)
- `dist/background.js` exists (IIFE bundle)

- [ ] **Step 3: Fix any build issues**

Common issues:
- **Import path errors**: Fix relative paths in `import` statements
- **Missing exports**: Ensure all used functions have `export` keyword
- **Vite manifest path mismatch**: Adjust `public/manifest.json` paths to match actual output

If Vite's `format: 'iife'` causes issues with HTML entries, use the multi-step build approach from the spec: main Vite build for HTML entries, then a separate Rollup step for content/background IIFE bundles.

- [ ] **Step 4: Load extension and test**

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" → select `dist/` directory
4. Open any webpage, click the extension icon
5. Test each feature:
   - [ ] AI chat (send message, get streaming response)
   - [ ] Quick actions (summarize, translate, key info)
   - [ ] Selection quote (highlight text on page, see preview)
   - [ ] TTS (click speaker on AI response)
   - [ ] Chat history (create, load, delete)
   - [ ] Export chat
   - [ ] Quick commands (/ in input)
   - [ ] Suggest questions (auto-generated after response)
   - [ ] Theme toggle (dark/light)
   - [ ] Settings page (gear icon → options page works)
   - [ ] Language switch (Chinese ↔ English)
   - [ ] OCR (image upload)
   - [ ] Outline generation
   - [ ] New chat button

- [ ] **Step 5: Commit working build**

```bash
git add -A
git commit -m "feat: complete Vite modularization — all features working"
```

---

## Task 10: Cleanup & Documentation

**Files:**
- Delete: original `side_panel/`, `options/`, `content.js`, `service_worker.js`, `i18n.js`, `libs/`, `manifest.json` (at root)
- Update: `CLAUDE.md`

- [ ] **Step 1: Delete original files**

Only after confirming ALL features work in Task 9.

Remove:
- `side_panel/` directory (original)
- `options/` directory (original)
- `content.js`
- `service_worker.js`
- `i18n.js`
- `libs/` directory (marked.min.js, Readability.js — now npm packages)
- `manifest.json` (at root — now in `public/`)

- [ ] **Step 2: Update CLAUDE.md**

Update the Architecture section to reflect the new module structure:
- New directory layout with `src/` and `public/`
- Module loading: single `<script type="module">` per HTML page
- Build commands: `npm run dev`, `npm run build`
- Load extension from `dist/` instead of project root
- Update file table to show new paths

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: clean up legacy files and update documentation"
```
