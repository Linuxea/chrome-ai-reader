# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

小🍐子阅读助手 — a Chrome Extension (Manifest V3) that helps users summarize, translate, extract key information from, and ask questions about the current webpage. Supports bilingual UI (Chinese/English). Built with Vite — source files use ES Modules in `src/`, build produces a `dist/` directory loaded by Chrome.

## Loading & Testing

- **Build**: `npm run build` — runs Vite then Rollup IIFE bundles for content script/service worker
- **Watch mode**: `npm run dev` — `vite build --watch` for development
- **Install**: Open `chrome://extensions/` → enable Developer mode → "Load unpacked" → select the `dist/` directory
- **Configure**: Click the extension icon → settings gear → expand "大模型配置" panel → enter an API Key (and optional API base URL). Defaults to DeepSeek (`https://api.deepseek.com`) with model `deepseek-chat`

## Architecture

### Build system

Vite bundles the extension with two phases:

1. **Vite build** — processes `src/side_panel/index.html` and `src/options/index.html` as entry points. ES modules are bundled into chunks under `dist/assets/`. HTML references are rewritten to point to the bundled output.
2. **Rollup IIFE** (`build-extension.js`) — bundles `src/content/index.js` and `src/background/service-worker.js` as self-contained IIFE scripts (required because Chrome cannot use ES modules for content scripts or service workers). Output: `dist/content.js` and `dist/background.js`.
3. **Static assets** — `public/` is copied verbatim to `dist/` (includes `manifest.json`, `icons/`).

### Module loading and dependency layers

Source files use ES Modules (`import`/`export`). Each HTML page has a single `<script type="module">` entry point that pulls in its dependency tree. The side panel has a 5-layer dependency hierarchy:

```
Layer 1 — Shared (no deps)
  src/shared/i18n.js        — TRANSLATIONS, t(), loadLanguage()
  src/shared/constants.js   — TRUNCATE_LIMITS, safeTruncate(), escapeHtml()

Layer 2 — State (depends on shared)
  src/side_panel/state.js   — getter/setter for all mutable state, subscribe/notify

Layer 3 — UI (depends on shared + state)
  src/side_panel/ui/dom-helpers.js  — DOM manipulation, message rendering
  src/side_panel/ui/theme.js        — dark mode + multi-theme management
  src/side_panel/ui/model-status.js — model status bar display

Layer 4 — Services (depends on shared + state + UI)
  src/side_panel/services/ai-chat.js — core AI conversation logic, streaming SSE
  src/side_panel/services/tts.js     — TTS sentence queueing, MediaSource streaming
  src/side_panel/services/ocr.js     — image upload, OCR processing

Layer 5 — Features (depends on services + UI + state)
  src/side_panel/features/chat-history.js      — chat persistence, export
  src/side_panel/features/quick-commands.js    — slash-command popup
  src/side_panel/features/suggest-questions.js — auto-generate follow-up questions
  src/side_panel/features/outline.js           — outline generation
  src/side_panel/features/image-input.js       — image paste and drag-drop

Entry point:
  src/side_panel/main.js — orchestrates init order, binds global events
```

`main.js` initializes layers bottom-up: async inits (language, state) in parallel, then UI, then services, then features, then AI chat (last, to inject feature callbacks and avoid circular deps). Each module exports `init*()` functions that accept callbacks/refs via a config object.

### Key files

| File | Role |
|------|------|
| `public/manifest.json` | Extension config, permissions (`activeTab`, `sidePanel`, `scripting`, `storage`) |
| `vite.config.js` | Vite configuration: two HTML entry points (side_panel, options), output to `dist/` |
| `build-extension.js` | Post-Vite Rollup step: bundles content script and service worker as IIFE |
| `src/shared/i18n.js` | Internationalization: `TRANSLATIONS` object (zh/en), `t(key, params)` function, `loadLanguage()` from storage, auto-applies via `data-i18n`/`data-i18n-html`/`data-i18n-placeholder`/`data-i18n-title` attributes |
| `src/shared/constants.js` | Shared utilities: `TRUNCATE_LIMITS`, `safeTruncate()`, `escapeHtml()` |
| `src/content/index.js` | Content script injected into all pages. Handles `{ action: 'extract' }` messages (Readability.js, fallback to `body.innerText`). Also monitors `selectionchange` with 300ms debounce and sends selected text to service worker |
| `src/background/service-worker.js` | Background service worker. Opens side panel on icon click. Handles long-lived port connections (`ai-chat`, `tts`, `suggest`) for streaming API calls. Relays `selectionChanged` messages. Proxies `fetchModels` requests from options page to avoid CORS. Reads config from `chrome.storage.sync` |
| `src/side_panel/state.js` | Centralized state with getter/setter pattern for all mutable state. Includes `subscribe(key, cb)` for reactive notifications on `isGenerating` changes. Async `initState()` reads from `chrome.storage` |
| `src/side_panel/main.js` | Side panel entry point: orchestrates initialization of all layers, binds global DOM events, wires callbacks between modules |
| `src/side_panel/services/ai-chat.js` | Core AI conversation logic: `extractPageContent`, `handleQuickAction`, `sendToAI`, `sendMessage`, `retryMessage`, `callAI` (streaming SSE with thinking/reasoning support) |
| `src/side_panel/services/tts.js` | TTS logic: sentence queueing, Markdown stripping, MediaSource streaming, auto-play toggle |
| `src/side_panel/features/chat-history.js` | Chat persistence and export: save/load/delete chats, render history list, export as Markdown |
| `src/side_panel/features/quick-commands.js` | Slash-command popup: filter, keyboard navigation, execute. Listens to `chrome.storage.onChanged` for hot-reload |
| `src/side_panel/ui/dom-helpers.js` | DOM helpers: `escapeHtml`, append/remove/update messages, scroll management, Markdown rendering, button state toggles |
| `src/side_panel/ui/theme.js` | Dark mode toggle and multi-theme management: applies `data-theme`/`data-theme-name` attributes, storage sync |
| `src/side_panel/services/ocr.js` | Image upload, OCR processing, preview management, context building for AI |
| `src/side_panel/features/suggest-questions.js` | Auto-generate follow-up questions after AI response: streaming via `suggest-questions` port |
| `src/side_panel/ui/model-status.js` | Model status bar display: reads `modelName` from storage, shows current model |
| `src/side_panel/features/image-input.js` | Image paste and drag-drop handling |
| `src/side_panel/features/outline.js` | Outline generation from page content |
| `src/options/index.js` | Settings page with collapsible panels: 大模型配置 + TTS 语音合成配置 (saved via button), 快捷指令 (real-time save), 数据管理 (export/import JSON) |

### Message flow (the core data paths)

**Page content extraction & AI chat:**
```
User action in side_panel
  → chrome.tabs.sendMessage → content script (extracts page via Readability.js)
  → chrome.runtime.connect({ name: 'ai-chat' }) → service worker
  → fetch to OpenAI-compatible API (streaming SSE)
  → port.postMessage({ type: 'chunk', content }) back to side_panel
  → rendered via marked.js into the chat area
```

**TTS audio streaming:**
```
User clicks speaker button on AI message in side_panel
  → chrome.runtime.connect({ name: 'tts' }) → service worker
  → POST to Volcengine TTS SSE endpoint (openspeech.bytedance.com)
  → SSE events parsed (352=audio data, 152=session finish, 153=failure)
  → port.postMessage({ type: 'chunk', data: base64Audio }) back to side_panel
  → MediaSource + SourceBuffer streams mp3 to Audio element (plays as chunks arrive)
```

**Selection quote relay (user highlights text on page):**
```
content script listens to document.selectionchange (300ms debounce)
  → chrome.runtime.sendMessage({ action: 'selectionChanged' })
  → service worker relays (with forwarded flag to prevent loop)
  → side_panel receives → shows quote preview bar above input
  → On send: quote injected into user message with adapted prompt
```

**Model list fetch (settings page gets available models):**
```
options sends chrome.runtime.sendMessage({ action: 'fetchModels', apiBase, apiKey })
  → service worker proxies GET {apiBase}/models (avoids CORS from options page)
  → returns { success, models: string[] } → options populates <datalist>
```

**OCR text extraction (image/PDF to Markdown):**
```
side_panel sends chrome.runtime.sendMessage({ action: 'ocrParse', file: '<url or data:uri>' })
  → service worker reads ocrApiKey from chrome.storage.sync
  → POST https://open.bigmodel.cn/api/paas/v4/layout-parsing
    headers: Authorization: Bearer <ocrApiKey>
    body: { model: 'glm-ocr', file: '<url or data:uri>' }
  → returns { success, data } or { success: false, error }
```

**Suggest questions (auto-generate follow-ups):**
```
AI response completes in side_panel
  → if suggestQuestionsEnabled, chrome.runtime.connect({ name: 'suggest' }) → service worker
  → POST to same OpenAI-compatible API with special prompt (generates 3 follow-up questions)
  → port.postMessage({ type: 'chunk', content }) back to side_panel
  → rendered as clickable suggestion buttons below AI message
```

### Communication patterns

- **Content extraction**: `chrome.tabs.sendMessage` (one-shot request/response) — content script returns `{ success, data: { title, textContent, excerpt, content, byline, siteName } }`
- **AI streaming**: `chrome.runtime.connect` long-lived port named `ai-chat` — side panel sends `{ type: 'chat', messages }`, receives `{ type: 'thinking', content }` (reasoning model), `{ type: 'chunk', content }`, `{ type: 'done' }`, or `{ type: 'error', error }`
- **TTS streaming**: `chrome.runtime.connect` long-lived port named `tts` — `tts.js` sends `{ type: 'tts', text }`, receives `{ type: 'chunk', data }` (base64 mp3), `{ type: 'done' }`, or `{ type: 'error', error }`. Audio plays via MediaSource Extensions (MSE) for true streaming playback
- **Suggest questions**: `chrome.runtime.connect` long-lived port named `suggest` — side panel sends `{ type: 'suggest', messages }`, receives `{ type: 'chunk', content }` (one question per line), `{ type: 'done' }`, or `{ type: 'error', error }`
- **Selection relay**: `chrome.runtime.sendMessage` one-shot — content script sends `{ action: 'selectionChanged', text }`, service worker re-sends with `forwarded: true` flag to prevent infinite loop, side panel receives and shows quote preview
- **Model list**: `chrome.runtime.sendMessage` one-shot — options page sends `{ action: 'fetchModels', apiBase, apiKey }`, service worker proxies `GET {apiBase}/models` and returns model IDs. Uses `sendResponse` with `return true` for async response
- **OCR text extraction**: `chrome.runtime.sendMessage` one-shot — side panel sends `{ action: 'ocrParse', file: '<url or data:uri>' }`, service worker reads `ocrApiKey` from sync storage, proxies `POST https://open.bigmodel.cn/api/paas/v4/layout-parsing` with `{ model: 'glm-ocr', file }`, returns `{ success, data }` or `{ success: false, error }`. Uses `sendResponse` with `return true` for async response
- **Settings sync**: `chrome.storage.onChanged` listener in side panel — model name, system prompt, quick commands, dark mode, theme, and language update in real-time without page reload

### Volcengine TTS API specifics

- **Endpoint**: `https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse` (SSE format)
- **Auth headers**: `X-Api-App-Id` (App ID), `X-Api-Access-Key` (Access Token), `X-Api-Resource-Id` (e.g. `seed-tts-2.0`)
- **Critical**: The `additions` field in the request body is a **JSON string**, not a nested object: `additions: '{"disable_markdown_filter":true}'`
- **SSE events**: `352` = audio chunk (base64 in `data` field), `152` = session finish, `153` = session failure. Event `152` may appear twice (start and end), so only treat as "done" after `receivedAudio` flag is set
- **Speaker default**: `zh_female_vv_uranus_bigtts`

### Quick-action prompt behavior

The three built-in quick actions (总结, 翻译, 提取关键信息) adapt their prompts based on whether the user has selected text:

- **No selection**: prompt targets "这篇网页内容" (the full page)
- **With selection**: prompt targets "用户引用的这段内容" (the selected text), and the selected text is prepended to the user message as a quote

### Storage

- **`chrome.storage.sync`**: `apiKey`, `apiBase`, `modelName`, `systemPrompt`, `ttsAppId`, `ttsAccessKey`, `ttsResourceId`, `ttsSpeaker`, `ttsAutoPlay`, `ocrApiKey`, `darkMode`, `themeName`, `language` (`'zh'` or `'en'`), `suggestQuestions` (boolean) — config synced across devices
- **`chrome.storage.local`**: `chatHistories` (up to 50 conversations), `quickCommands` (array of `{ name, prompt }`)
- Optional fields are removed via `chrome.storage.sync.remove()` / `chrome.storage.local.remove()` when empty, not stored as empty strings
- Settings export/import bundles all sync fields + quickCommands into a versioned JSON file

### State management

Centralized in `src/side_panel/state.js` using a getter/setter pattern. Each state field has a `get*()`/`set*()` export pair. The module also provides:

- `subscribe(key, callback)` — register a listener for state changes (currently used for `isGenerating` notifications)
- `initState()` — async function that reads `systemPrompt`, `activeTabId`, `quickCommands`, and `suggestQuestions` from chrome.storage on startup

State fields:

- `pageContent` / `pageExcerpt` / `pageTitle` — cached extracted page content
- `conversationHistory` — array of `{ role, content }` messages for the current session
- `isGenerating` — boolean lock to prevent concurrent API calls (has subscribe notification)
- `customSystemPrompt` — user-defined system prompt loaded from storage, appended to default prompt
- `currentChatId` — ID of the active conversation in history, `null` for a fresh session
- `selectedText` — current highlighted text from the page (shown in quote preview bar)
- `activeTabId` — tab ID the side panel is associated with, used to filter selection messages
- `quickCommands` — cached array of user-defined quick commands from storage
- `suggestQuestionsEnabled` — boolean for auto-generating follow-up questions after AI response
- `ocrResults` — array of `{ index, fileName, text }` for OCR-recognized image content (in-memory, cleared on send/new chat)
- `ocrRunning` — counter for in-progress OCR API calls
- `imageIndex` — auto-incrementing index for image numbering
- Content is truncated to ~64000 chars for context and quotes (via `safeTruncate` from `constants.js`)

TTS state lives in `src/side_panel/services/tts.js` (module-scoped, not in state.js).

### Dark mode (夜间模式)

- Toggle button in side panel header (moon/sun icon) and options page header
- Pure manual toggle — no system preference detection
- `darkMode` boolean stored in `chrome.storage.sync`, persisted across sessions
- Works within each theme — toggling dark mode preserves the current theme palette
- Implementation: `data-theme="light|dark"` + `data-theme-name="sujian|ocean|forest"` attributes on `<html>` element
- CSS uses compound selectors like `[data-theme-name="ocean"][data-theme="dark"]` to define theme-specific dark variants
- Both `side_panel.css` and `options.css` define variable blocks for all themes (`:root` serves as 素笺 default)
- `chrome.storage.onChanged` listener syncs both `darkMode` and `themeName` between side panel and options page

### Multi-theme system (多主题)

- Three built-in themes: 素笺 (`sujian`, default warm brown), 海洋 (`ocean`, cool blue), 森林 (`forest`, natural green)
- Each theme defines a complete set of CSS custom properties for both light and dark variants
- Theme picker lives in settings page (options.html) as a collapsible "外观主题" section with color swatch cards
- `themeName` string stored in `chrome.storage.sync`, defaults to `"sujian"` if absent
- Theme choice is included in export/import JSON via `SYNC_FIELDS`
- Side panel reads `themeName` from storage and applies it but has no theme picker UI — only the settings page allows selection

### Internationalization (i18n)

- Bilingual support: Chinese (`zh`, default) and English (`en`)
- `src/shared/i18n.js` defines `TRANSLATIONS` object with all UI strings keyed by dot-notation (e.g., `'settings.llm.apiKey'`)
- Translation function: `t(key, params)` — supports placeholder interpolation (e.g., `t('status.modelsLoaded', { n: 5 })` → `"已获取 5 个模型"`)
- DOM attributes for auto-translation:
  - `data-i18n="key"` — sets `textContent`
  - `data-i18n-html="key"` — sets `innerHTML` (for links/hints)
  - `data-i18n-placeholder="key"` — sets `placeholder`
  - `data-i18n-title="key"` — sets `title` (tooltip)
- Language stored in `chrome.storage.sync` as `language` (`'zh'` or `'en'`)
- `loadLanguage(callback)` reads from storage and applies translations on page load
- `chrome.storage.onChanged` listener auto-switches language in real-time when changed in settings

## Conventions

- UI supports Chinese (default) and English via i18n system — all strings in `TRANSLATIONS` object, no hardcoded UI text
- Default prompts for quick actions are in Chinese even when UI language is English (user can customize via system prompt)
- CSS uses CSS custom properties defined in `side_panel.css` and `options.css` for theming; theme selection via `[data-theme-name="..."]` selectors, dark mode via compound `[data-theme-name="..."][data-theme="dark"]` selectors
- No framework — vanilla JS with ES Modules, bundled by Vite for production
- The API endpoint is OpenAI-compatible (defaults to DeepSeek, but any compatible endpoint works via the `apiBase` setting)
- API path convention: `apiBase` does NOT include `/v1` — endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`
- TTS button only appears on the latest AI message; clicking while playing stops playback (toggle behavior)
- TTS stops automatically when user sends a new AI message or starts a new chat
- `ttsAutoPlay` — boolean in sync storage, when true automatically triggers TTS playback after AI response completes
- `suggestQuestions` — boolean in sync storage, when true auto-generates 3 follow-up questions after AI response; questions appear as clickable buttons
- Retry button appears on the latest user message; clicking it truncates conversation from that point and resends the message
