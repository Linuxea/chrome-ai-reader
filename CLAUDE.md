# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

小🍐子阅读助手 — a Chrome Extension (Manifest V3) that helps users summarize, translate, extract key information from, and ask questions about the current webpage. Supports bilingual UI (Chinese/English). There is no build system — all files are plain HTML/CSS/JS loaded directly by Chrome.

## Loading & Testing

- **Install**: Open `chrome://extensions/` → enable Developer mode → "Load unpacked" → select this directory
- **No build step, no package manager** — edits to any file take effect after reloading the extension in `chrome://extensions/`
- **Configure**: Click the extension icon → settings gear → expand "大模型配置" panel → enter an API Key (and optional API base URL). Defaults to DeepSeek (`https://api.deepseek.com`) with model `deepseek-chat`

## Architecture

### Module loading and global scope

No ES modules — scripts share a single global scope, loaded in dependency order via `<script>` tags. The side panel loads:

```
i18n.js → marked.min.js → chat-history.js → quick-commands.js → ui-helpers.js → theme.js → tts-streaming.js → outline.js → ocr.js → suggest-questions.js → model-status.js → side_panel.js → ai-chat.js → image-input.js
```

`i18n.js` must load first (defines `t()`, `loadLanguage()`, `setLanguage()`). `side_panel.js` defines shared globals (DOM refs, state variables, `safeTruncate`, `TRUNCATE_LIMITS`). `ui-helpers.js` defines `escapeHtml` and DOM helper functions. `ai-chat.js` contains the core AI conversation logic and must load after `side_panel.js` (which declares the state variables it reads/writes). Helper scripts consume those globals at call time. Load order in HTML is the only thing ensuring symbols exist when referenced.

### Key files

| File | Role |
|------|------|
| `manifest.json` | Extension config, permissions (`activeTab`, `sidePanel`, `scripting`, `storage`) |
| `i18n.js` | Internationalization: `TRANSLATIONS` object (zh/en), `t(key, params)` function, `loadLanguage()` from storage, auto-applies via `data-i18n`/`data-i18n-html`/`data-i18n-placeholder`/`data-i18n-title` attributes |
| `content.js` | Content script injected into all pages. Handles `{ action: 'extract' }` messages (Readability.js, fallback to `body.innerText`). Also monitors `selectionchange` with 300ms debounce and sends selected text to service worker |
| `service_worker.js` | Background service worker. Opens side panel on icon click. Handles long-lived port connections (`ai-chat`, `tts`, `suggest`) for streaming API calls. Relays `selectionChanged` messages. Proxies `fetchModels` requests from options page to avoid CORS. Reads config from `chrome.storage.sync` |
| `side_panel/side_panel.js` | Global state declarations, DOM refs, event bindings, small utilities (`safeTruncate`, `updateQuotePreview`). The "spine" that other modules plug into |
| `side_panel/ai-chat.js` | Core AI conversation logic: `extractPageContent`, `handleQuickAction`, `sendToAI`, `sendMessage`, `retryMessage`, `callAI` (streaming SSE with thinking/reasoning support) |
| `side_panel/tts-streaming.js` | TTS logic: sentence queueing, Markdown stripping, MediaSource streaming, auto-play toggle. State vars prefixed with `tts` (e.g., `ttsPort`, `ttsPlaying`, `ttsSentenceQueue`) |
| `side_panel/chat-history.js` | Chat persistence and export: save/load/delete chats, render history list, export as Markdown |
| `side_panel/quick-commands.js` | Slash-command popup: filter, keyboard navigation, execute. Listens to `chrome.storage.onChanged` for hot-reload |
| `side_panel/ui-helpers.js` | DOM helpers: `escapeHtml`, append/remove/update messages, scroll management, Markdown rendering, button state toggles |
| `side_panel/theme.js` | Dark mode toggle and multi-theme management: applies `data-theme`/`data-theme-name` attributes, storage sync |
| `side_panel/ocr.js` | Image upload, OCR processing, preview management, context building for AI |
| `side_panel/suggest-questions.js` | Auto-generate follow-up questions after AI response: streaming via `suggest-questions` port |
| `side_panel/model-status.js` | Model status bar display: reads `modelName` from storage, shows current model |
| `side_panel/image-input.js` | Image paste and drag-drop handling (IIFE) |
| `options/options.js` | Settings page with collapsible panels: 大模型配置 + TTS 语音合成配置 (saved via button), 快捷指令 (real-time save), 数据管理 (export/import JSON) |

### Message flow (the core data paths)

**Page content extraction & AI chat:**
```
User action in side_panel.js
  → chrome.tabs.sendMessage → content.js (extracts page via Readability.js)
  → chrome.runtime.connect({ name: 'ai-chat' }) → service_worker.js
  → fetch to OpenAI-compatible API (streaming SSE)
  → port.postMessage({ type: 'chunk', content }) back to side_panel.js
  → rendered via marked.js into the chat area
```

**TTS audio streaming:**
```
User clicks speaker button on AI message in side_panel.js
  → chrome.runtime.connect({ name: 'tts' }) → service_worker.js
  → POST to Volcengine TTS SSE endpoint (openspeech.bytedance.com)
  → SSE events parsed (352=audio data, 152=session finish, 153=failure)
  → port.postMessage({ type: 'chunk', data: base64Audio }) back to side_panel.js
  → MediaSource + SourceBuffer streams mp3 to Audio element (plays as chunks arrive)
```

**Selection quote relay (user highlights text on page):**
```
content.js listens to document.selectionchange (300ms debounce)
  → chrome.runtime.sendMessage({ action: 'selectionChanged' })
  → service_worker.js relays (with forwarded flag to prevent loop)
  → side_panel.js receives → shows quote preview bar above input
  → On send: quote injected into user message with adapted prompt
```

**Model list fetch (settings page gets available models):**
```
options.js sends chrome.runtime.sendMessage({ action: 'fetchModels', apiBase, apiKey })
  → service_worker.js proxies GET {apiBase}/models (avoids CORS from options page)
  → returns { success, models: string[] } → options.js populates <datalist>
```

**OCR text extraction (image/PDF to Markdown):**
```
side_panel.js sends chrome.runtime.sendMessage({ action: 'ocrParse', file: '<url or data:uri>' })
  → service_worker.js reads ocrApiKey from chrome.storage.sync
  → POST https://open.bigmodel.cn/api/paas/v4/layout-parsing
    headers: Authorization: Bearer <ocrApiKey>
    body: { model: 'glm-ocr', file: '<url or data:uri>' }
  → returns { success, data } or { success: false, error }
```

**Suggest questions (auto-generate follow-ups):**
```
AI response completes in side_panel.js
  → if suggestQuestionsEnabled, chrome.runtime.connect({ name: 'suggest' }) → service_worker.js
  → POST to same OpenAI-compatible API with special prompt (generates 3 follow-up questions)
  → port.postMessage({ type: 'chunk', content }) back to side_panel.js
  → rendered as clickable suggestion buttons below AI message
```

### Communication patterns

- **Content extraction**: `chrome.tabs.sendMessage` (one-shot request/response) — `content.js` returns `{ success, data: { title, textContent, excerpt, content, byline, siteName } }`
- **AI streaming**: `chrome.runtime.connect` long-lived port named `ai-chat` — `side_panel.js` sends `{ type: 'chat', messages }`, receives `{ type: 'thinking', content }` (reasoning model), `{ type: 'chunk', content }`, `{ type: 'done' }`, or `{ type: 'error', error }`
- **TTS streaming**: `chrome.runtime.connect` long-lived port named `tts` — `tts-streaming.js` sends `{ type: 'tts', text }`, receives `{ type: 'chunk', data }` (base64 mp3), `{ type: 'done' }`, or `{ type: 'error', error }`. Audio plays via MediaSource Extensions (MSE) for true streaming playback
- **Suggest questions**: `chrome.runtime.connect` long-lived port named `suggest` — `side_panel.js` sends `{ type: 'suggest', messages }`, receives `{ type: 'chunk', content }` (one question per line), `{ type: 'done' }`, or `{ type: 'error', error }`
- **Selection relay**: `chrome.runtime.sendMessage` one-shot — `content.js` sends `{ action: 'selectionChanged', text }`, `service_worker.js` re-sends with `forwarded: true` flag to prevent infinite loop, `side_panel.js` receives and shows quote preview
- **Model list**: `chrome.runtime.sendMessage` one-shot — `options.js` sends `{ action: 'fetchModels', apiBase, apiKey }`, `service_worker.js` proxies `GET {apiBase}/models` and returns model IDs. Uses `sendResponse` with `return true` for async response
- **OCR text extraction**: `chrome.runtime.sendMessage` one-shot — `side_panel.js` sends `{ action: 'ocrParse', file: '<url or data:uri>' }`, `service_worker.js` reads `ocrApiKey` from sync storage, proxies `POST https://open.bigmodel.cn/api/paas/v4/layout-parsing` with `{ model: 'glm-ocr', file }`, returns `{ success, data }` or `{ success: false, error }`. Uses `sendResponse` with `return true` for async response
- **Settings sync**: `chrome.storage.onChanged` listener in side_panel — model name, system prompt, quick commands, dark mode, theme, and language update in real-time without page reload

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

### State management in side_panel.js

- `pageContent` / `pageExcerpt` / `pageTitle` — cached extracted page content
- `conversationHistory` — array of `{ role, content }` messages for the current session
- `isGenerating` — boolean lock to prevent concurrent API calls
- `customSystemPrompt` — user-defined system prompt loaded from storage, appended to default prompt
- `currentChatId` — ID of the active conversation in history, `null` for a fresh session
- `selectedText` — current highlighted text from the page (shown in quote preview bar)
- `activeTabId` — tab ID the side panel is associated with, used to filter selection messages
- `quickCommands` — cached array of user-defined quick commands from storage
- `suggestQuestionsEnabled` — boolean for auto-generating follow-up questions after AI response
- `suggestPort` — long-lived port for suggest questions streaming
- `ocrResults` — array of `{ index, fileName, text }` for OCR-recognized image content (in-memory, cleared on send/new chat)
- `ocrRunning` — counter for in-progress OCR API calls
- `imageIndex` — auto-incrementing index for image numbering
- Content is truncated to ~64000 chars for context and quotes (via `safeTruncate`)

TTS state lives in `tts-streaming.js` (not side_panel.js): `ttsPort`, `ttsPlaying`, `ttsDone`, `ttsMediaSource`, `ttsSourceBuffer`, `ttsAudioEl`, `ttsChunkQueue`, `ttsBufferAppending`, `ttsSentenceQueue`, `ttsTextBuffer`, `ttsSending`, `ttsSentenceCount`, `ttsAutoPlayEnabled`

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
- `i18n.js` defines `TRANSLATIONS` object with all UI strings keyed by dot-notation (e.g., `'settings.llm.apiKey'`)
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
- No framework — vanilla JS with direct DOM manipulation
- The API endpoint is OpenAI-compatible (defaults to DeepSeek, but any compatible endpoint works via the `apiBase` setting)
- API path convention: `apiBase` does NOT include `/v1` — endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`
- TTS button only appears on the latest AI message; clicking while playing stops playback (toggle behavior)
- TTS stops automatically when user sends a new AI message or starts a new chat
- `ttsAutoPlay` — boolean in sync storage, when true automatically triggers TTS playback after AI response completes
- `suggestQuestions` — boolean in sync storage, when true auto-generates 3 follow-up questions after AI response; questions appear as clickable buttons
- Retry button appears on the latest user message; clicking it truncates conversation from that point and resends the message
