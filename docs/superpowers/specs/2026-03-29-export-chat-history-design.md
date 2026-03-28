# Export Chat History — Design

## Overview

Add a Markdown export feature to the AI Reading Assistant Chrome extension. Users can export the current conversation or any historical conversation as a `.md` file with one click.

## UI Changes

### Chat area header

- Add an export icon button (download arrow SVG, see below) **between the new chat button and the settings button** in the header actions bar. Button order becomes: history, new chat, **export**, settings.
- Clicking it exports the current conversation. If the chat area has no `.message` elements, the button does nothing.
- SVG icon (inline, matching existing icon style — 18x18, stroke-based):
  ```html
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
  ```

### History panel

- Add an export icon button as a sibling to `.history-item-delete` inside each `.history-item`, placed **before** the delete button. Same small 14x14 SVG as the download arrow but scaled to match the delete button size.
- The export button follows the same hover-reveal pattern as the delete button (same `opacity` / visibility CSS).
- SVG icon (14x14, matching delete button size):
  ```html
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
  ```

## Export Behavior

- Direct download — no preview or confirmation dialog.
- File name format: `AI阅读助手_YYYY-MM-DD_{sanitizedTitle}.md`
  - Title portion is sanitized: replace `/ \ : * ? " < > |` and newlines with `_`, truncate to 30 chars max.
  - Example: `AI阅读助手_2026-03-29_总结页面.md`
- Empty current conversation (no `.message` elements in chat area): button click is a no-op.
- Historical conversations are never empty (saved only when `messages.length > 0`), so no guard needed for history export buttons.

## Markdown Format

```markdown
# AI 阅读助手 — 聊天记录

> 页面：{pageTitle}
> 导出时间：{YYYY-MM-DD HH:mm}
> 模型：{modelName}

---

## 👤 用户

{user message text}

## 🤖 AI 助手

{AI response — raw Markdown from conversationHistory}

---

## 👤 用户

{next user message}

## 🤖 AI 助手

{next AI response}
```

### Metadata handling

- **`pageTitle`**: If empty, omit the `> 页面：` line entirely.
- **`modelName`**: Read from `chrome.storage.sync` at export time. This shows the *current* model, not necessarily the model used during the conversation. This is an acknowledged limitation — the chat record does not store which model was used.
- **Export timestamp**: Generated at export time, formatted as `YYYY-MM-DD HH:mm`.

### Content source

- **User messages**: plain text from `messages[].content` (role `user`).
- **AI messages**: raw Markdown from `conversationHistory` entries (role `assistant`). This preserves code blocks, lists, and other formatting. The `messages` array stores rendered HTML which is not suitable for Markdown export.
- **Fallback**: If `conversationHistory` does not contain an AI response (edge case for older history records), strip HTML from `messages[].content` by creating a temporary DOM element and reading its `.textContent` property:
  ```js
  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent;
  }
  ```

### Pairing logic

Messages in `messages[]` and `conversationHistory` are paired by order. Both arrays follow user/assistant alternation. To build the export:
1. Iterate `messages[]` for the sequence and user text.
2. For each assistant message, look up the corresponding entry in `conversationHistory` by index/position to get raw Markdown.

## Implementation

### Export function

A single `exportChatAsMarkdown(chatData)` function that:
1. Reads model name from `chrome.storage.sync` (async).
2. Builds the Markdown string from chat data using the pairing logic above.
3. Sanitizes the title for use in the file name.
4. Creates a `Blob` with `type: 'text/markdown;charset=utf-8'`.
5. Creates a temporary `<a>` element with `URL.createObjectURL`, sets `download` attribute, clicks it, then revokes the URL.

### Current conversation export

- Calls `getDisplayMessages()` **only** to check emptiness (returns early if empty array).
- For user message text: reads from `getDisplayMessages()` entries with `role === 'user'`.
- For AI message text: reads from the in-memory `conversationHistory` array, matching by position.
- `pageTitle` comes from the in-memory `pageTitle` variable.

### History entry export

- Reads the full chat record from `chrome.storage.local` via `getChatHistories()`.
- Uses `conversationHistory` from the record for AI response text.
- `pageTitle` comes from `chat.pageTitle`.
- Same fallback (`.textContent` stripping) for missing raw Markdown.

### Files to modify

| File | Change |
|------|--------|
| `side_panel/side_panel.html` | Add export button to header (between new chat and settings) |
| `side_panel/side_panel.js` | Add `exportChatAsMarkdown()`, `stripHtml()`, `sanitizeFilename()`; wire up header click handler; update `renderHistoryList()` to add export button per item |
| `side_panel/side_panel.css` | Style the header export button (`.icon-btn` already provides base styling); add `.history-item-export` with same hover-reveal as `.history-item-delete` |
