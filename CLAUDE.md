# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI 阅读助手 (AI Reading Assistant) — a Chrome Extension (Manifest V3) that helps users summarize, translate, extract key information from, and ask questions about the current webpage. The UI is in Chinese. There is no build system — all files are plain HTML/CSS/JS loaded directly by Chrome.

## Loading & Testing

- **Install**: Open `chrome://extensions/` → enable Developer mode → "Load unpacked" → select this directory
- **No build step, no package manager** — edits to any file take effect after reloading the extension in `chrome://extensions/`
- **Configure**: Click the extension icon → settings gear → enter an API Key (and optional API base URL). Defaults to DeepSeek (`https://api.deepseek.com`) with model `deepseek-chat`

## Architecture

### Message flow (the core data path)

```
User action in side_panel.js
  → chrome.tabs.sendMessage → content.js (extracts page via Readability.js)
  → chrome.runtime.connect({ name: 'ai-chat' }) → service_worker.js
  → fetch to OpenAI-compatible API (streaming SSE)
  → port.postMessage({ type: 'chunk' }) back to side_panel.js
  → rendered via marked.js into the chat area
```

### Key files and their roles

| File | Role |
|------|------|
| `manifest.json` | Extension config, permissions (`activeTab`, `sidePanel`, `scripting`, `storage`) |
| `content.js` | Content script injected into all pages. Listens for `{ action: 'extract' }` messages, uses `Readability.js` to parse the page, falls back to `document.body.innerText` |
| `service_worker.js` | Background service worker. Opens side panel on icon click. Handles long-lived port connections (`ai-chat`) for streaming API calls. Reads `apiKey`/`apiBase` from `chrome.storage.sync` |
| `side_panel/side_panel.js` | Main UI logic. Manages page content state, conversation history, quick-action prompts, and streaming display. Uses `marked.parse()` for AI response rendering |
| `side_panel/side_panel.html` | Side panel UI with quick-action buttons (summarize, translate, key info) and chat interface |
| `options/options.js` | Settings page. Saves/loads `apiKey` and `apiBase` from `chrome.storage.sync` |
| `libs/Readability.js` | Mozilla's Readability library for extracting article content from web pages |
| `libs/marked.min.js` | Markdown-to-HTML renderer for AI responses |

### Communication patterns

- **Content extraction**: `chrome.tabs.sendMessage` (one-shot request/response) — `content.js` returns `{ success, data: { title, textContent, excerpt, content, byline, siteName } }`
- **AI streaming**: `chrome.runtime.connect` long-lived port named `ai-chat` — `side_panel.js` sends `{ type: 'chat', messages }`, receives `{ type: 'chunk', content }`, `{ type: 'done' }`, or `{ type: 'error', error }`
- **Settings**: `chrome.storage.sync` for `apiKey`, `apiBase`, and `systemPrompt`
- **Chat history**: `chrome.storage.local` for `chatHistories` (up to 50 conversations, each with id, title, messages, conversationHistory, timestamps)

### State management in side_panel.js

- `pageContent` / `pageExcerpt` / `pageTitle` — cached extracted page content
- `conversationHistory` — array of `{ role, content }` messages for the current session
- `isGenerating` — boolean lock to prevent concurrent API calls
- `customSystemPrompt` — user-defined system prompt loaded from storage, appended to default prompt
- `currentChatId` — ID of the active conversation in history, `null` for a fresh session
- Content is truncated to ~12000 chars for quick actions, ~8000 chars for Q&A context

## Conventions

- All user-facing strings are in Chinese
- CSS uses CSS custom properties defined in `side_panel.css` (`:root` block) for theming
- No framework — vanilla JS with direct DOM manipulation
- The API endpoint is OpenAI-compatible (defaults to DeepSeek, but any compatible endpoint works via the `apiBase` setting)
