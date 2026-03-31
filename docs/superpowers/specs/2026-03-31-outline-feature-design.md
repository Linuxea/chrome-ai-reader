# Feature Design: Smart Outline & Knowledge Cards

**Date**: 2026-03-31
**Status**: Approved
**Focus**: Improving reading efficiency through deeper information extraction

## Problem

Current quick actions (summarize, translate, extract key info) provide shallow, one-shot extraction. Users read a full article but struggle to grasp the logical structure and key points at a glance. There is no way to get a structured, navigable breakdown of an article's content.

## Solution

Add a fourth quick-action button **"Outline"** that generates an interactive, collapsible tree-structured outline of the current webpage. Each node in the tree expands into a "knowledge card" with the section's core argument, key data points, and a relevant quote from the original text.

## User Flow

1. User navigates to an article and clicks the "Outline" button in the side panel
2. Loading state: skeleton animation appears in a chat bubble
3. Page content is extracted (existing `extractContent` flow)
4. AI generates a JSON-structured outline via the existing `ai-chat` streaming port
5. JSON is parsed and rendered as an interactive tree in the chat bubble
6. User clicks tree nodes to expand/collapse knowledge cards
7. User can copy the outline or export it as Markdown
8. User can continue chatting about the outline in subsequent messages

## UI Design

### Entry Point

A new quick-action button alongside the existing three (Summarize, Translate, Key Info):
- Text from i18n key `quickActions.outline` (Chinese: "大纲", English: "Outline")

### Outline Bubble Layout

```
┌─────────────────────────────────────┐
│  📋 Article Outline              ▾  │
├─────────────────────────────────────┤
│  ▸ 1. Background & Motivation       │
│  ▾ 2. Core Method                   │
│    ┌───────────────────────────┐    │
│    │ Core Argument              │    │
│    │ This paper proposes...     │    │
│    │                            │    │
│    │ Key Data                   │    │
│    │ • Accuracy improved 12%    │    │
│    │ • Parameters reduced 40%   │    │
│    │                            │    │
│    │ Original Quote             │    │
│    │ "We adopted a hybrid..."   │    │
│    └───────────────────────────┘    │
│    ▸ 2.1 Model Architecture         │
│    ▸ 2.2 Training Strategy          │
│  ▸ 3. Experimental Results          │
│  ▸ 4. Conclusions & Limitations     │
│                                     │
│  [Copy Outline]  [Export Markdown]  │
└─────────────────────────────────────┘
```

Each knowledge card has three fixed sections:
- **Core Argument** (1-2 sentences summarizing the section's central point)
- **Key Data** (bullet points of numbers, metrics, comparisons; empty array if none)
- **Original Quote** (most relevant paragraph from the source text)

### Skeleton Loading State

While waiting for JSON response, display a shimmer skeleton animation with placeholder bars representing the outline structure.

## AI Prompt Design

### System Prompt

A dedicated outline-generation prompt appended after the existing system prompt:

```
You are a content analysis expert. Analyze the article content into a structured outline.

Requirements:
1. Generate 2-5 top-level sections, each with 0-4 subsections
2. For each section node, provide:
   - "summary": core argument (1-2 sentences)
   - "data": key data points list (numbers, metrics, comparisons; empty array if none)
   - "quote": most relevant original text passage (one paragraph)
3. Section headings should reflect the article's logical structure, not simply restate original headings

Return strictly in the following JSON format, with no other text:
{
  "title": "Article main thesis (one sentence)",
  "sections": [
    {
      "heading": "Section title",
      "summary": "...",
      "data": ["...", "..."],
      "quote": "...",
      "children": [
        {
          "heading": "Subsection title",
          "summary": "...",
          "data": [],
          "quote": "...",
          "children": []
        }
      ]
    }
  ]
}
```

### Forcing JSON Output

Use `response_format: { type: "json_object" }` at the API level to constrain the model to valid JSON output. This is supported by most OpenAI-compatible APIs including DeepSeek.

**Note**: When using `json_object` mode, the prompt must contain the word "JSON" (already satisfied by our prompt).

## Data Flow

```
User clicks "Outline"
  → side_panel.js: extractContent() retrieves page text
  → Build messages array:
      [
        { role: "system", content: outline-specific prompt },
        { role: "user", content: page text (safeTruncated) }
      ]
  → chrome.runtime.connect({ name: 'ai-chat' })
  → port.postMessage({
      type: 'chat',
      messages,
      response_format: { type: "json_object" }
    })
  → service_worker.js forwards to OpenAI-compatible API (SSE streaming)
  → stream response → side_panel.js collects full JSON
  → JSON.parse() → renderOutline(data)
  → render outline tree in chat bubble
```

### service_worker.js Change

Pass through `response_format` from the chat message:

```javascript
const body = {
  model: modelName,
  messages: msg.messages,
  stream: true,
};
if (msg.response_format) {
  body.response_format = msg.response_format;
}
```

This is a forward-compatible change: normal chat messages don't include `response_format`, so behavior is unchanged.

## Code Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `side_panel/outline.js` | IIFE module: outline generation, JSON→DOM rendering, collapse/expand, copy/export |
| `side_panel/outline.css` | Styles: tree structure, knowledge cards, skeleton animation, theme variables |

### Modified Files

| File | Change |
|------|--------|
| `side_panel/side_panel.html` | Add outline.js/outline.css, add Outline button in quick-action bar |
| `side_panel/side_panel.js` | Add click handler for Outline button, call `generateOutline()` |
| `side_panel/ui-helpers.js` | Support `type: "outline"` message rendering when restoring from history |
| `service_worker.js` | Pass through `response_format` field in ai-chat port messages |
| `i18n.js` | Add outline-related translation keys |

### Script Load Order

```
i18n.js → marked.min.js → chat-history.js → quick-commands.js
→ ui-helpers.js → tts-streaming.js → outline.js → side_panel.js
                                         ↑ NEW
```

`outline.js` loads before `side_panel.js` so `side_panel.js` can call `generateOutline()`.

### outline.js Module Structure

```javascript
;(function() {
  const OUTLINE_PROMPT = '...';  // outline-specific system prompt

  function generateOutline(pageContent, pageTitle) { ... }
  function renderOutline(data) { ... }
  function renderOutlineSkeleton() { ... }
  function outlineToMarkdown(data) { ... }
  function parseOutlineResponse(rawText) { ... }

  window.generateOutline = generateOutline;
  window.renderOutlineSkeleton = renderOutlineSkeleton;
})();
```

IIFE pattern with `window` exposure — consistent with `image-input.js`.

## JSON Parsing Fallback Strategy

```javascript
function parseOutlineResponse(rawText) {
  // Attempt 1: Direct parse (JSON mode makes this almost always succeed)
  try {
    const data = JSON.parse(rawText);
    if (data.title && data.sections) return data;
  } catch(e) {}

  // Attempt 2: Trim whitespace (some models add leading/trailing whitespace)
  try {
    const data = JSON.parse(rawText.trim());
    if (data.title && data.sections) return data;
  } catch(e) {}

  // Fallback: render as plain Markdown AI message
  return null;
}
```

When `parseOutlineResponse` returns `null`, the raw text is rendered as a normal Markdown AI response with a retry button.

## Error Handling

| Scenario | Handling |
|----------|----------|
| No page open | Show `t('outline.noContent')` toast, don't send request |
| API returns non-JSON (model doesn't support json mode) | Fallback: render as normal Markdown AI reply |
| Valid JSON but wrong structure (missing title/sections) | Show `t('outline.parseError')` + retry button |
| API timeout / network error | Reuse existing error handling (error bubble) |
| Page content too short (< 200 chars) | Show hint: "Content too short for a meaningful outline" |
| `isGenerating` lock conflict | Reuse existing lock mechanism, button shows loading state |

## Chat History Integration

- Outline is stored in `conversationHistory` as an AI message with content = raw JSON string
- Message includes a `type: "outline"` marker: `{ role: "assistant", content: jsonString, type: "outline" }`
- When restoring from history, detect `type: "outline"` and call `renderOutline()` instead of Markdown rendering
- When exporting chat as Markdown, outline messages go through `outlineToMarkdown()` for proper formatting

## i18n Keys

```javascript
// Chinese
'quickActions.outline': '大纲',
'outline.title': '文章大纲',
'outline.copySuccess': '大纲已复制',
'outline.export': '导出 Markdown',
'outline.noContent': '请先打开一个网页再生成大纲',
'outline.parseError': '大纲解析失败，请重试',
'outline.tooShort': '内容太短，无法生成有意义的大纲',

// English
'quickActions.outline': 'Outline',
'outline.title': 'Article Outline',
'outline.copySuccess': 'Outline copied',
'outline.export': 'Export Markdown',
'outline.noContent': 'Please open a webpage first',
'outline.parseError': 'Failed to parse outline, please retry',
'outline.tooShort': 'Content is too short for a meaningful outline',
```

## Scope Exclusions

- Not implementing per-node streaming (collect full JSON before rendering)
- Not implementing custom outline depth configuration (fixed 2-level depth)
- Not implementing outline editing by the user
- Not implementing outline persistence independent of chat history
- Not implementing structured outputs with JSON Schema (using basic `json_object` mode for broader compatibility)
