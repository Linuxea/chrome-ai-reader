# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI 阅读助手 (AI Reading Assistant) — a Chrome Extension (Manifest V3) that helps users summarize, translate, extract key information from, and ask questions about the current webpage. The UI is in Chinese. There is no build system — all files are plain HTML/CSS/JS loaded directly by Chrome.

## Loading & Testing

- **Install**: Open `chrome://extensions/` → enable Developer mode → "Load unpacked" → select this directory
- **No build step, no package manager** — edits to any file take effect after reloading the extension in `chrome://extensions/`
- **Configure**: Click the extension icon → settings gear → enter an API Key (and optional API base URL). Defaults to DeepSeek (`https://api.deepseek.com`) with model `deepseek-chat`

## Architecture

### Message flow (the core data paths)

**Page content extraction & AI chat:**
```
User action in side_panel.js
  → chrome.tabs.sendMessage → content.js (extracts page via Readability.js)
  → chrome.runtime.connect({ name: 'ai-chat' }) → service_worker.js
  → fetch to OpenAI-compatible API (streaming SSE)
  → port.postMessage({ type: 'chunk' }) back to side_panel.js
  → rendered via marked.js into the chat area
```

**Selection quote relay (user highlights text on page):**
```
content.js listens to document.selectionchange (300ms debounce)
  → chrome.runtime.sendMessage({ action: 'selectionChanged' })
  → service_worker.js relays (with forwarded flag to prevent loop)
  → side_panel.js receives → shows quote preview bar above input
  → On send: quote injected as virtual user/assistant pair into AI messages
```

**Model list fetch (settings page gets available models):**
```
options.js sends chrome.runtime.sendMessage({ action: 'fetchModels', apiBase, apiKey })
  → service_worker.js proxies GET {apiBase}/models (avoids CORS from options page)
  → returns { success, models: string[] } → options.js populates <datalist>
```

### Key files and their roles

| File | Role |
|------|------|
| `manifest.json` | Extension config, permissions (`activeTab`, `sidePanel`, `scripting`, `storage`) |
| `content.js` | Content script injected into all pages. Handles `{ action: 'extract' }` messages (Readability.js, fallback to `body.innerText`). Also monitors `selectionchange` with 300ms debounce and sends selected text to service worker |
| `service_worker.js` | Background service worker. Opens side panel on icon click. Handles long-lived port connections (`ai-chat`) for streaming API calls. Relays `selectionChanged` messages. Proxies `fetchModels` requests from options page to avoid CORS. Reads `apiKey`/`apiBase`/`modelName` from `chrome.storage.sync`. Model defaults to `deepseek-chat` |
| `side_panel/side_panel.js` | Main UI logic. Manages page content state, conversation history, quick-action prompts, streaming display, and chat export as Markdown. Uses `marked.parse()` for AI response rendering. Shows current model name in status bar |
| `side_panel/side_panel.html` | Side panel UI with quick-action buttons (summarize, translate, key info) and chat interface |
| `options/options.js` | Settings page. Saves/loads `apiKey`, `apiBase`, `modelName`, and `systemPrompt` from `chrome.storage.sync`. Fetches model list from API via service worker relay and populates `<datalist>` |
| `libs/Readability.js` | Mozilla's Readability library for extracting article content from web pages |
| `libs/marked.min.js` | Markdown-to-HTML renderer for AI responses |

### Communication patterns

- **Content extraction**: `chrome.tabs.sendMessage` (one-shot request/response) — `content.js` returns `{ success, data: { title, textContent, excerpt, content, byline, siteName } }`
- **AI streaming**: `chrome.runtime.connect` long-lived port named `ai-chat` — `side_panel.js` sends `{ type: 'chat', messages }`, receives `{ type: 'thinking', content }` (reasoning model), `{ type: 'chunk', content }`, `{ type: 'done' }`, or `{ type: 'error', error }`
- **Selection relay**: `chrome.runtime.sendMessage` one-shot — `content.js` sends `{ action: 'selectionChanged', text }`, `service_worker.js` re-sends with `forwarded: true` flag to prevent infinite loop, `side_panel.js` receives and shows quote preview
- **Model list**: `chrome.runtime.sendMessage` one-shot — `options.js` sends `{ action: 'fetchModels', apiBase, apiKey }`, `service_worker.js` proxies `GET {apiBase}/models` and returns model IDs. Uses `sendResponse` with `return true` for async response
- **Settings**: `chrome.storage.sync` for `apiKey`, `apiBase`, `modelName`, and `systemPrompt`
- **Chat history**: `chrome.storage.local` for `chatHistories` (up to 50 conversations, each with id, title, messages, conversationHistory, timestamps). Export uses `conversationHistory` for raw AI Markdown, with `stripHtml` fallback for old records missing raw text
- **Quick commands**: `chrome.storage.local` for `quickCommands` (array of `{ name, prompt }`). Managed in settings page with real-time save. Side panel loads on init and listens to `chrome.storage.onChanged`. Triggered by typing `/` in chat input

### State management in side_panel.js

- `pageContent` / `pageExcerpt` / `pageTitle` — cached extracted page content
- `conversationHistory` — array of `{ role, content }` messages for the current session
- `isGenerating` — boolean lock to prevent concurrent API calls
- `customSystemPrompt` — user-defined system prompt loaded from storage, appended to default prompt
- `currentChatId` — ID of the active conversation in history, `null` for a fresh session
- `selectedText` — current highlighted text from the page (shown in quote preview bar)
- `activeTabId` — tab ID the side panel is associated with, used to filter selection messages
- `quickCommands` — cached array of user-defined quick commands from storage
- Content is truncated to ~32000 chars for quick actions, Q&A context, and quotes (via `safeTruncate`)

## Conventions

- All user-facing strings are in Chinese
- CSS uses CSS custom properties defined in `side_panel.css` (`:root` block) for theming
- No framework — vanilla JS with direct DOM manipulation
- The API endpoint is OpenAI-compatible (defaults to DeepSeek, but any compatible endpoint works via the `apiBase` setting)
- API path convention: `apiBase` does NOT include `/v1` — endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`
- Optional storage fields (`apiBase`, `modelName`, `systemPrompt`) are removed via `chrome.storage.sync.remove()` when empty, not stored as empty strings
