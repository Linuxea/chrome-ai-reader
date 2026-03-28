# Export Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Markdown export for current and historical chat conversations.

**Architecture:** Three utility functions (`sanitizeFilename`, `stripHtml`, `exportChatAsMarkdown`) in side_panel.js, new export button in header + history items, matching existing UI patterns.

**Tech Stack:** Vanilla JS, Chrome Extension APIs, Blob download.

---

### Task 1: Add export button to header HTML

**Files:**
- Modify: `side_panel/side_panel.html` (header actions)

- [ ] Add export button between newChatBtn and settingsBtn with download arrow SVG

### Task 2: Add export utility functions to side_panel.js

**Files:**
- Modify: `side_panel/side_panel.js`

- [ ] Add `sanitizeFilename(title)` — replace illegal chars with `_`, truncate to 30 chars
- [ ] Add `stripHtml(html)` — temporary div `.textContent` fallback
- [ ] Add `exportChatAsMarkdown(chatData)` — builds Markdown string, creates Blob, triggers download via temporary `<a>` element

### Task 3: Wire up header export button for current conversation

**Files:**
- Modify: `side_panel/side_panel.js`

- [ ] Add DOM reference for export button
- [ ] Add click handler: check if chat area has messages, build chatData from `getDisplayMessages()` + `conversationHistory` + `pageTitle`, call `exportChatAsMarkdown`

### Task 4: Add export button to history items

**Files:**
- Modify: `side_panel/side_panel.js` (renderHistoryList)
- Modify: `side_panel/side_panel.css` (history-item-export style)

- [ ] Update `renderHistoryList()` to add export button before delete button in each history item
- [ ] Add `.history-item-export` CSS matching `.history-item-delete` hover-reveal pattern

### Task 5: Commit

- [ ] Commit all changes with descriptive message
