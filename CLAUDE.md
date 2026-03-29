# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

小🍐子阅读助手 — a Chrome Extension (Manifest V3) that helps users summarize, translate, extract key information from, and ask questions about the current webpage. The UI is in Chinese. There is no build system — all files are plain HTML/CSS/JS loaded directly by Chrome.

## Loading & Testing

- **Install**: Open `chrome://extensions/` → enable Developer mode → "Load unpacked" → select this directory
- **No build step, no package manager** — edits to any file take effect after reloading the extension in `chrome://extensions/`
- **Configure**: Click the extension icon → settings gear → expand "大模型配置" panel → enter an API Key (and optional API base URL). Defaults to DeepSeek (`https://api.deepseek.com`) with model `deepseek-chat`

## Architecture

### Module loading and global scope

No ES modules — scripts share a single global scope, loaded in dependency order via `<script>` tags. The side panel loads:

```
marked.min.js → chat-history.js → quick-commands.js → ui-helpers.js → side_panel.js
```

`side_panel.js` defines shared globals (DOM refs, state variables, `escapeHtml`, `TRUNCATE_LIMITS`). The three helper scripts consume those globals at call time. Load order in HTML is the only thing ensuring symbols exist when referenced.

### Key files

| File | Role |
|------|------|
| `manifest.json` | Extension config, permissions (`activeTab`, `sidePanel`, `scripting`, `storage`) |
| `content.js` | Content script injected into all pages. Handles `{ action: 'extract' }` messages (Readability.js, fallback to `body.innerText`). Also monitors `selectionchange` with 300ms debounce and sends selected text to service worker |
| `service_worker.js` | Background service worker. Opens side panel on icon click. Handles long-lived port connections (`ai-chat`, `tts`) for streaming API calls. Relays `selectionChanged` messages. Proxies `fetchModels` requests from options page to avoid CORS. Reads config from `chrome.storage.sync` |
| `side_panel/side_panel.js` | Main orchestrator. Defines shared state variables, manages page content extraction, conversation flow, quick-action prompts (adapts based on selection), streaming display, TTS playback via MediaSource Extensions |
| `side_panel/chat-history.js` | Chat persistence and export: save/load/delete chats, render history list, export as Markdown |
| `side_panel/quick-commands.js` | Slash-command popup: filter, keyboard navigation, execute. Listens to `chrome.storage.onChanged` for hot-reload |
| `side_panel/ui-helpers.js` | DOM helpers: append/remove/update messages, scroll management, Markdown rendering, button state toggles |
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

### Communication patterns

- **Content extraction**: `chrome.tabs.sendMessage` (one-shot request/response) — `content.js` returns `{ success, data: { title, textContent, excerpt, content, byline, siteName } }`
- **AI streaming**: `chrome.runtime.connect` long-lived port named `ai-chat` — `side_panel.js` sends `{ type: 'chat', messages }`, receives `{ type: 'thinking', content }` (reasoning model), `{ type: 'chunk', content }`, `{ type: 'done' }`, or `{ type: 'error', error }`
- **TTS streaming**: `chrome.runtime.connect` long-lived port named `tts` — `side_panel.js` sends `{ type: 'tts', text }`, receives `{ type: 'chunk', data }` (base64 mp3), `{ type: 'done' }`, or `{ type: 'error', error }`. Audio plays via MediaSource Extensions (MSE) for true streaming playback
- **Selection relay**: `chrome.runtime.sendMessage` one-shot — `content.js` sends `{ action: 'selectionChanged', text }`, `service_worker.js` re-sends with `forwarded: true` flag to prevent infinite loop, `side_panel.js` receives and shows quote preview
- **Model list**: `chrome.runtime.sendMessage` one-shot — `options.js` sends `{ action: 'fetchModels', apiBase, apiKey }`, `service_worker.js` proxies `GET {apiBase}/models` and returns model IDs. Uses `sendResponse` with `return true` for async response
- **Settings sync**: `chrome.storage.onChanged` listener in side_panel — model name, system prompt, and quick commands update in real-time without page reload

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

- **`chrome.storage.sync`**: `apiKey`, `apiBase`, `modelName`, `systemPrompt`, `ttsAppId`, `ttsAccessKey`, `ttsResourceId`, `ttsSpeaker` — config synced across devices
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
- TTS state: `ttsPort`, `ttsPlaying`, `ttsDone`, `ttsMediaSource`, `ttsSourceBuffer`, `ttsAudioEl`, `ttsChunkQueue`, `ttsBufferAppending`
- Content is truncated to ~64000 chars for context and quotes (via `safeTruncate`)

## Conventions

- All user-facing strings are in Chinese
- CSS uses CSS custom properties defined in `side_panel.css` (`:root` block) for theming
- No framework — vanilla JS with direct DOM manipulation
- The API endpoint is OpenAI-compatible (defaults to DeepSeek, but any compatible endpoint works via the `apiBase` setting)
- API path convention: `apiBase` does NOT include `/v1` — endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`
- TTS button only appears on the latest AI message; clicking while playing stops playback (toggle behavior)
- TTS stops automatically when user sends a new AI message or starts a new chat
