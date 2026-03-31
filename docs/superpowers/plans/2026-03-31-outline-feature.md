# Smart Outline & Knowledge Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Outline" quick-action button that generates an interactive, collapsible tree-structured outline with knowledge cards from the current webpage.

**Architecture:** New IIFE module `outline.js` + `outline.css` follows the existing `image-input.js` pattern. Uses the existing `ai-chat` port with `response_format: { type: "json_object" }` to force JSON output. Renders outline tree inside a normal AI chat bubble. Integrates with chat history via `type: "outline"` message marker.

**Tech Stack:** Vanilla JS, CSS custom properties (theme-aware), Chrome Extension APIs (storage, runtime.connect, tabs)

**Design Spec:** `docs/superpowers/specs/2026-03-31-outline-feature-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `side_panel/outline.js` | Create | IIFE: outline prompt, JSON parsing, DOM tree rendering, collapse/expand, copy/export |
| `side_panel/outline.css` | Create | Tree structure, knowledge cards, skeleton animation, theme variables |
| `side_panel/side_panel.html` | Modify | Add outline.css link, outline.js script tag, Outline button in quick-actions |
| `side_panel/side_panel.js` | Modify | Add `handleQuickAction('outline')` handler, call `generateOutline()` |
| `service_worker.js` | Modify | Pass through `response_format` in `callOpenAI()` |
| `i18n.js` | Modify | Add outline-related translation keys (zh + en) |
| `side_panel/ui-helpers.js` | Modify | Support `type: "outline"` when restoring from chat history |
| `side_panel/chat-history.js` | Modify | Store/restore outline type in chat messages |

---

## Task 1: Add i18n translation keys

**Files:**
- Modify: `i18n.js` (inside `TRANSLATIONS.zh` object ~line 87 and `TRANSLATIONS.en` object ~line 243)

- [ ] **Step 1: Add Chinese translation keys**

In `TRANSLATIONS.zh`, after the `'action.export': '导出'` line (~line 93), add:

```javascript
'action.outline': '大纲',
'outline.title': '文章大纲',
'outline.copySuccess': '大纲已复制',
'outline.export': '导出 Markdown',
'outline.noContent': '请先打开一个网页再生成大纲',
'outline.parseError': '大纲解析失败，请重试',
'outline.tooShort': '内容太短，无法生成有意义的大纲',
'outline.copy': '复制大纲',
```

In `TRANSLATIONS.zh`, after `'prompt.suggestAI'` (~line 151), add:

```javascript
'prompt.outline': '你是一个内容分析专家。请将文章内容分析为结构化大纲。\n\n要求：\n1. 生成 2-5 个一级标题，每个一级标题下可有 0-4 个二级标题\n2. 为每个标题节点提供：\n   - "summary": 核心论点（1-2 句话）\n   - "data": 关键数据点列表（数字、指标、对比；若无则为空数组）\n   - "quote": 最相关的原文引用（一段原文）\n3. 标题应反映文章的逻辑结构，而非简单复述原文标题\n\n请严格按以下 JSON 格式返回，不要包含任何其他文字：\n{\n  "title": "文章主旨（一句话）",\n  "sections": [\n    {\n      "heading": "标题",\n      "summary": "...",\n      "data": ["...", "..."],\n      "quote": "...",\n      "children": [\n        {\n          "heading": "子标题",\n          "summary": "...",\n          "data": [],\n          "quote": "...",\n          "children": []\n        }\n      ]\n    }\n  ]\n}',
```

- [ ] **Step 2: Add English translation keys**

In `TRANSLATIONS.en`, after the `'action.export': 'Export'` line (~line 248), add:

```javascript
'action.outline': 'Outline',
'outline.title': 'Article Outline',
'outline.copySuccess': 'Outline copied',
'outline.export': 'Export Markdown',
'outline.noContent': 'Please open a webpage first',
'outline.parseError': 'Failed to parse outline, please retry',
'outline.tooShort': 'Content is too short for a meaningful outline',
'outline.copy': 'Copy Outline',
```

In `TRANSLATIONS.en`, after `'prompt.suggestAI'` (~line 303), add:

```javascript
'prompt.outline': 'You are a content analysis expert. Analyze the article content into a structured outline.\n\nRequirements:\n1. Generate 2-5 top-level sections, each with 0-4 subsections\n2. For each section node, provide:\n   - "summary": core argument (1-2 sentences)\n   - "data": key data points list (numbers, metrics, comparisons; empty array if none)\n   - "quote": most relevant original text passage (one paragraph)\n3. Section headings should reflect the article\'s logical structure, not simply restate original headings\n\nReturn strictly in the following JSON format, with no other text:\n{\n  "title": "Article main thesis (one sentence)",\n  "sections": [\n    {\n      "heading": "Section title",\n      "summary": "...",\n      "data": ["...", "..."],\n      "quote": "...",\n      "children": [\n        {\n          "heading": "Subsection title",\n          "summary": "...",\n          "data": [],\n          "quote": "...",\n          "children": []\n        }\n      ]\n    }\n  ]\n}',
```

- [ ] **Step 3: Commit**

```bash
git add i18n.js
git commit -m "feat(i18n): add outline feature translation keys"
```

---

## Task 2: Pass through response_format in service worker

**Files:**
- Modify: `service_worker.js:7-30` (the `callOpenAI` function)

- [ ] **Step 1: Modify callOpenAI to accept and pass response_format**

Change the `callOpenAI` function signature and body to accept `options` parameter:

```javascript
async function callOpenAI(messages, port, options) {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);

  if (!apiKey) {
    port.postMessage({ type: 'error', errorKey: 'error.noApiKey' });
    return;
  }

  const baseUrl = apiBase || 'https://api.deepseek.com';

  const requestBody = {
    model: modelName || 'deepseek-chat',
    messages: messages,
    stream: true,
    temperature: 0.7
  };

  if (options?.response_format) {
    requestBody.response_format = options.response_format;
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
```

The rest of the function stays the same.

- [ ] **Step 2: Update the ai-chat port listener to pass options**

Change the ai-chat port handler (~line 250-254):

```javascript
  if (port.name === 'ai-chat') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'chat') {
        await callOpenAI(msg.messages, port, { response_format: msg.response_format });
      }
    });
  }
```

- [ ] **Step 3: Commit**

```bash
git add service_worker.js
git commit -m "feat(sw): pass through response_format for JSON mode support"
```

---

## Task 3: Add Outline button to HTML

**Files:**
- Modify: `side_panel/side_panel.html:9` (add CSS link), `side_panel.html:77-90` (add button), `side_panel.html:137` (add script tag)

- [ ] **Step 1: Add outline.css link**

After the `quick-commands.css` link (~line 9), add:

```html
  <link rel="stylesheet" href="outline.css">
```

- [ ] **Step 2: Add Outline button to quick-actions**

After the existing three action buttons (~line 89), add a fourth:

```html
      <button class="action-btn" data-action="outline">
        <span class="action-icon">📑</span>
        <span data-i18n="action.outline">大纲</span>
      </button>
```

- [ ] **Step 3: Add outline.js script tag**

Before the `side_panel.js` script tag (~line 137), add:

```html
  <script src="outline.js"></script>
```

The final script load order should be:

```html
  <script src="../i18n.js"></script>
  <script src="../libs/marked.min.js"></script>
  <script src="chat-history.js"></script>
  <script src="quick-commands.js"></script>
  <script src="ui-helpers.js"></script>
  <script src="tts-streaming.js"></script>
  <script src="outline.js"></script>
  <script src="side_panel.js"></script>
  <script src="image-input.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add side_panel/side_panel.html
git commit -m "feat(html): add outline button and script/css references"
```

---

## Task 4: Create outline.css

**Files:**
- Create: `side_panel/outline.css`

- [ ] **Step 1: Write outline.css with theme-aware styles**

Create `side_panel/outline.css`:

```css
/* outline.css — 大纲功能样式 */

/* === Skeleton loading === */
.outline-skeleton {
  padding: 12px 16px;
}
.outline-skeleton-line {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--border) 25%, var(--hover-overlay) 50%, var(--border) 75%);
  background-size: 200% 100%;
  animation: outline-shimmer 1.5s infinite;
  margin-bottom: 10px;
}
.outline-skeleton-line:nth-child(1) { width: 60%; }
.outline-skeleton-line:nth-child(2) { width: 85%; }
.outline-skeleton-line:nth-child(3) { width: 45%; }
.outline-skeleton-line:nth-child(4) { width: 75%; }
.outline-skeleton-line:nth-child(5) { width: 55%; }

@keyframes outline-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* === Outline container === */
.outline-container {
  margin: 4px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--primary-light);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 14px;
  color: var(--primary);
}

.outline-title-text {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* === Outline node (tree item) === */
.outline-node {
  border-bottom: 1px solid var(--border);
}
.outline-node:last-child {
  border-bottom: none;
}

.outline-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  transition: background 0.15s;
  user-select: none;
}
.outline-heading:hover {
  background: var(--hover-overlay);
}

.outline-arrow {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.2s;
  flex-shrink: 0;
}
.outline-node.expanded > .outline-heading .outline-arrow {
  transform: rotate(90deg);
}

.outline-heading-text {
  flex: 1;
}

/* Indent for child nodes */
.outline-children {
  display: none;
}
.outline-node.expanded > .outline-children {
  display: block;
}
.outline-children .outline-node {
  padding-left: 20px;
}

/* === Knowledge card === */
.outline-card {
  display: none;
  padding: 10px 14px 10px 38px;
  background: var(--primary-light);
  border-top: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.6;
}
.outline-node.expanded > .outline-card {
  display: block;
}

.outline-card-section {
  margin-bottom: 8px;
}
.outline-card-section:last-child {
  margin-bottom: 0;
}

.outline-card-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--primary);
  margin-bottom: 3px;
  letter-spacing: 0.3px;
}

.outline-card-summary {
  color: var(--text);
}

.outline-card-data {
  list-style: none;
  padding: 0;
}
.outline-card-data li {
  position: relative;
  padding-left: 14px;
  color: var(--text);
}
.outline-card-data li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--primary);
  font-weight: bold;
}

.outline-card-quote {
  border-left: 3px solid var(--primary);
  padding: 6px 10px;
  color: var(--text-secondary);
  font-style: italic;
  background: rgba(var(--primary-rgb), 0.05);
  border-radius: 0 4px 4px 0;
}

/* === Outline footer (action buttons) === */
.outline-footer {
  display: flex;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--primary-light);
}

.outline-action-btn {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--card-bg);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s;
}
.outline-action-btn:hover {
  background: var(--primary);
  color: var(--user-text);
  border-color: var(--primary);
}
```

- [ ] **Step 2: Commit**

```bash
git add side_panel/outline.css
git commit -m "feat(css): add outline feature styles with skeleton and knowledge cards"
```

---

## Task 5: Create outline.js

**Files:**
- Create: `side_panel/outline.js`

This is the core task. The module follows the IIFE pattern of `image-input.js`.

- [ ] **Step 1: Write outline.js**

Create `side_panel/outline.js`:

```javascript
// outline.js — 智能大纲功能

(function() {
  'use strict';

  // === JSON parsing with fallback ===

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

    // Fallback: return null, caller renders as plain Markdown
    return null;
  }

  // === Outline to Markdown export ===

  function outlineToMarkdown(data, depth) {
    depth = depth || 0;
    const prefix = '#'.repeat(Math.min(depth + 2, 6));
    let md = '';

    if (depth === 0 && data.title) {
      md += `# ${data.title}\n\n`;
    }

    const items = depth === 0 ? data.sections : (data.children || []);
    items.forEach(function(section) {
      md += `${prefix} ${section.heading}\n\n`;
      if (section.summary) {
        md += `${section.summary}\n\n`;
      }
      if (section.data && section.data.length > 0) {
        md += '**' + t('outline.keyData', { defaultValue: '关键数据' }) + ':**\n';
        section.data.forEach(function(d) {
          md += `- ${d}\n`;
        });
        md += '\n';
      }
      if (section.quote) {
        md += `> ${section.quote.replace(/\n/g, '\n> ')}\n\n`;
      }
      if (section.children && section.children.length > 0) {
        md += outlineToMarkdown(section, depth + 1);
      }
    });

    return md;
  }

  // === DOM rendering ===

  function renderOutlineNode(section) {
    const node = document.createElement('div');
    node.className = 'outline-node';

    // Heading row with arrow
    const heading = document.createElement('div');
    heading.className = 'outline-heading';

    const arrow = document.createElement('span');
    arrow.className = 'outline-arrow';
    arrow.textContent = '▶';

    const headingText = document.createElement('span');
    headingText.className = 'outline-heading-text';
    headingText.textContent = section.heading;

    heading.appendChild(arrow);
    heading.appendChild(headingText);
    node.appendChild(heading);

    // Knowledge card
    const card = document.createElement('div');
    card.className = 'outline-card';

    if (section.summary) {
      const summarySection = document.createElement('div');
      summarySection.className = 'outline-card-section';

      const summaryLabel = document.createElement('div');
      summaryLabel.className = 'outline-card-label';
      summaryLabel.textContent = t('outline.label.summary', { defaultValue: '核心论点' });

      const summaryText = document.createElement('div');
      summaryText.className = 'outline-card-summary';
      summaryText.textContent = section.summary;

      summarySection.appendChild(summaryLabel);
      summarySection.appendChild(summaryText);
      card.appendChild(summarySection);
    }

    if (section.data && section.data.length > 0) {
      const dataSection = document.createElement('div');
      dataSection.className = 'outline-card-section';

      const dataLabel = document.createElement('div');
      dataLabel.className = 'outline-card-label';
      dataLabel.textContent = t('outline.label.data', { defaultValue: '关键数据' });

      const dataList = document.createElement('ul');
      dataList.className = 'outline-card-data';
      section.data.forEach(function(d) {
        const li = document.createElement('li');
        li.textContent = d;
        dataList.appendChild(li);
      });

      dataSection.appendChild(dataLabel);
      dataSection.appendChild(dataList);
      card.appendChild(dataSection);
    }

    if (section.quote) {
      const quoteSection = document.createElement('div');
      quoteSection.className = 'outline-card-section';

      const quoteLabel = document.createElement('div');
      quoteLabel.className = 'outline-card-label';
      quoteLabel.textContent = t('outline.label.quote', { defaultValue: '原文引用' });

      const quoteText = document.createElement('div');
      quoteText.className = 'outline-card-quote';
      quoteText.textContent = section.quote;

      quoteSection.appendChild(quoteLabel);
      quoteSection.appendChild(quoteText);
      card.appendChild(quoteSection);
    }

    node.appendChild(card);

    // Children
    if (section.children && section.children.length > 0) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'outline-children';
      section.children.forEach(function(child) {
        childrenEl.appendChild(renderOutlineNode(child));
      });
      node.appendChild(childrenEl);
    }

    // Toggle expand/collapse on click
    heading.addEventListener('click', function() {
      node.classList.toggle('expanded');
    });

    return node;
  }

  function renderOutline(data) {
    const container = document.createElement('div');
    container.className = 'outline-container';

    // Header
    const header = document.createElement('div');
    header.className = 'outline-header';

    const titleWrap = document.createElement('span');
    titleWrap.className = 'outline-title-text';
    titleWrap.textContent = data.title;

    header.appendChild(titleWrap);
    container.appendChild(header);

    // Sections
    data.sections.forEach(function(section) {
      container.appendChild(renderOutlineNode(section));
    });

    // Footer with action buttons
    const footer = document.createElement('div');
    footer.className = 'outline-footer';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'outline-action-btn';
    copyBtn.textContent = t('outline.copy', { defaultValue: '复制大纲' });
    copyBtn.addEventListener('click', function() {
      const md = outlineToMarkdown(data);
      navigator.clipboard.writeText(md).then(function() {
        copyBtn.textContent = t('outline.copySuccess');
        setTimeout(function() {
          copyBtn.textContent = t('outline.copy', { defaultValue: '复制大纲' });
        }, 1500);
      });
    });

    const exportBtn = document.createElement('button');
    exportBtn.className = 'outline-action-btn';
    exportBtn.textContent = t('outline.export');
    exportBtn.addEventListener('click', function() {
      const md = '# ' + (pageTitle || '') + '\n\n' + outlineToMarkdown(data);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'outline_' + (pageTitle || 'article').replace(/[/\\:*?"<>|]/g, '_').slice(0, 30) + '.md';
      a.click();
      URL.revokeObjectURL(url);
    });

    footer.appendChild(copyBtn);
    footer.appendChild(exportBtn);
    container.appendChild(footer);

    return container;
  }

  function renderOutlineSkeleton() {
    const container = document.createElement('div');
    container.className = 'outline-skeleton';
    container.innerHTML =
      '<div class="outline-skeleton-line"></div>' +
      '<div class="outline-skeleton-line"></div>' +
      '<div class="outline-skeleton-line"></div>' +
      '<div class="outline-skeleton-line"></div>' +
      '<div class="outline-skeleton-line"></div>';
    return container;
  }

  // === Main: generate outline ===

  function generateOutline() {
    if (isGenerating) return;

    if (!pageContent || pageContent.trim().length < 200) {
      // Try extracting first
      extractPageContent().then(function() {
        if (!pageContent || pageContent.trim().length < 200) {
          appendMessage('error', t('outline.noContent'));
          return;
        }
        doGenerateOutline();
      }).catch(function() {
        appendMessage('error', t('outline.noContent'));
      });
      return;
    }

    doGenerateOutline();
  }

  function doGenerateOutline() {
    if (isGenerating) return;
    isGenerating = true;
    setButtonsDisabled(true);

    if (ttsPlaying) stopTTS();
    removeSuggestQuestions();

    // Remove welcome message if present
    var welcome = chatArea.querySelector('.welcome-msg');
    if (welcome) welcome.remove();

    // Create AI message bubble with skeleton
    var msgEl = appendMessage('ai', '');
    var skeleton = renderOutlineSkeleton();
    msgEl.appendChild(skeleton);

    // Build messages
    var context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);
    var messages = [
      { role: 'system', content: t('prompt.outline') },
      { role: 'user', content: context }
    ];

    if (customSystemPrompt) {
      messages.splice(1, 0, { role: 'system', content: customSystemPrompt });
    }

    var fullText = '';
    var port = chrome.runtime.connect({ name: 'ai-chat' });

    port.postMessage({
      type: 'chat',
      messages: messages,
      response_format: { type: 'json_object' }
    });

    port.onMessage.addListener(function(msg) {
      if (msg.type === 'chunk') {
        fullText += msg.content;
      } else if (msg.type === 'done') {
        port.disconnect();
        skeleton.remove();

        var data = parseOutlineResponse(fullText);

        if (data) {
          var outlineEl = renderOutline(data);
          msgEl.appendChild(outlineEl);

          // Store in conversation history with outline marker
          conversationHistory.push({
            role: 'assistant',
            content: fullText,
            type: 'outline'
          });
        } else {
          // Fallback: render as Markdown
          msgEl.innerHTML = marked.parse(fullText);
          conversationHistory.push({ role: 'assistant', content: fullText });
        }

        isGenerating = false;
        setButtonsDisabled(false);
        scrollToBottom();
        saveCurrentChat();
      } else if (msg.type === 'error') {
        skeleton.remove();
        var errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || '');
        msgEl.innerHTML = '<span style="color:var(--error-text)">' + errorText + '</span>';
        isGenerating = false;
        setButtonsDisabled(false);
        port.disconnect();
      }
    });
  }

  // === Render outline from saved JSON (chat history restore) ===

  function renderOutlineFromJSON(jsonString) {
    var data = parseOutlineResponse(jsonString);
    if (data) {
      return renderOutline(data);
    }
    return null;
  }

  // === Expose to global scope ===

  window.generateOutline = generateOutline;
  window.renderOutlineFromJSON = renderOutlineFromJSON;

})();
```

- [ ] **Step 2: Commit**

```bash
git add side_panel/outline.js
git commit -m "feat(outline): add outline generation module with JSON parsing and tree rendering"
```

---

## Task 6: Wire up outline button in side_panel.js

**Files:**
- Modify: `side_panel/side_panel.js:421-425` (actionPrompts object)

- [ ] **Step 1: Add outline handler to handleQuickAction**

In the `handleQuickAction` function (~line 405), the function currently only handles `summarize`, `translate`, `keyInfo` via the `actionPrompts` object. Add a special case for `outline` before the existing logic:

```javascript
async function handleQuickAction(action) {
  if (isGenerating) return;

  if (action === 'outline') {
    generateOutline();
    return;
  }

  // ... existing code for summarize/translate/keyInfo ...
```

Insert this block at the top of the function body, right after `if (isGenerating) return;` and the OCR error checks. The outline action bypasses the OCR checks since it doesn't use images.

Actually, to keep it clean, insert after the `isGenerating` check but before the OCR checks, since outline doesn't need OCR:

```javascript
async function handleQuickAction(action) {
  if (isGenerating) return;

  if (action === 'outline') {
    generateOutline();
    return;
  }

  if (ocrRunning > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  // ... rest of existing code ...
```

- [ ] **Step 2: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat(side-panel): wire up outline button to generateOutline()"
```

---

## Task 7: Support outline in chat history restore

**Files:**
- Modify: `side_panel/chat-history.js:101-112` (the `loadChat` message rendering loop)
- Modify: `side_panel/ui-helpers.js` (no changes needed — outline.js handles rendering directly)

- [ ] **Step 1: Update loadChat to detect and render outline messages**

In `chat-history.js`, the `loadChat` function iterates `chat.messages` and renders them. Currently it stores `innerHTML` for assistant messages. We need to check if the message has `type: "outline"` and render the outline tree instead.

But first, we need to store the outline type in the display messages. Update `getDisplayMessages()` to also capture the `type` attribute:

In `getDisplayMessages()`, after checking for `message-ai` class (~line 29), also check for a `data-type` attribute:

```javascript
function getDisplayMessages() {
  const msgEls = chatArea.querySelectorAll('.message');
  const messages = [];
  msgEls.forEach(el => {
    if (el.classList.contains('message-user')) {
      const wrapper = el.closest('.user-msg-group');
      messages.push({ role: 'user', content: el.textContent });
    } else if (el.classList.contains('message-ai')) {
      messages.push({
        role: 'assistant',
        content: el.innerHTML,
        type: el.dataset.type || undefined
      });
    }
  });
  return messages;
}
```

- [ ] **Step 2: Mark outline messages with data-type attribute**

In `outline.js`, after rendering the outline, set `msgEl.dataset.type = 'outline'` and store the raw JSON in `msgEl.dataset.json`. Update the `doGenerateOutline` function's success path:

```javascript
if (data) {
  var outlineEl = renderOutline(data);
  msgEl.appendChild(outlineEl);
  msgEl.dataset.type = 'outline';
  msgEl.dataset.json = fullText;

  conversationHistory.push({
    role: 'assistant',
    content: fullText,
    type: 'outline'
  });
}
```

- [ ] **Step 3: Update loadChat to restore outline messages**

In the `loadChat` function's message rendering loop (~line 101-112):

```javascript
  chat.messages.forEach(msg => {
    const div = document.createElement('div');
    if (msg.role === 'user') {
      div.className = 'message message-user';
      div.textContent = msg.content;
    } else if (msg.role === 'assistant') {
      div.className = 'message message-ai';
      if (msg.type === 'outline' && msg.content) {
        // Try rendering as outline
        const outlineEl = renderOutlineFromJSON(msg.content);
        if (outlineEl) {
          div.appendChild(outlineEl);
          div.dataset.type = 'outline';
          div.dataset.json = msg.content;
        } else {
          div.innerHTML = marked.parse(msg.content);
        }
      } else {
        div.innerHTML = msg.content;
      }
    }
    chatArea.appendChild(div);
  });
```

Note: `msg.content` for outline messages was stored as innerHTML in the old code path. For new outline messages, we'll store raw JSON in `msg.content`. We need to handle this carefully. The `getDisplayMessages` function stores `innerHTML`, but for outline messages we need the raw JSON.

Update `getDisplayMessages` to store the raw JSON instead of innerHTML for outline messages:

```javascript
function getDisplayMessages() {
  const msgEls = chatArea.querySelectorAll('.message');
  const messages = [];
  msgEls.forEach(el => {
    if (el.classList.contains('message-user')) {
      messages.push({ role: 'user', content: el.textContent });
    } else if (el.classList.contains('message-ai')) {
      if (el.dataset.type === 'outline') {
        messages.push({
          role: 'assistant',
          content: el.dataset.json || el.innerHTML,
          type: 'outline'
        });
      } else {
        messages.push({ role: 'assistant', content: el.innerHTML });
      }
    }
  });
  return messages;
}
```

- [ ] **Step 4: Commit**

```bash
git add side_panel/chat-history.js side_panel/outline.js
git commit -m "feat(history): store and restore outline messages in chat history"
```

---

## Task 8: Support outline in Markdown export

**Files:**
- Modify: `side_panel/chat-history.js:216-227` (the export loop)

- [ ] **Step 1: Update exportChatAsMarkdown to handle outline messages**

In the `exportChatAsMarkdown` function, the loop that builds the markdown needs to detect outline messages and use the outline-to-markdown converter:

Replace the existing loop body (~line 218-228):

```javascript
  messages.forEach(msg => {
    if (msg.role === 'user') {
      md += '## ' + t('chat.user') + '\n\n' + msg.content + '\n\n';
    } else if (msg.role === 'assistant') {
      if (msg.type === 'outline') {
        const raw = assistantIdx < assistantEntries.length
          ? assistantEntries[assistantIdx].content
          : stripHtml(msg.content);
        assistantIdx++;
        // Parse outline JSON and convert to markdown
        try {
          const data = JSON.parse(raw);
          if (data.title && data.sections) {
            md += '## ' + t('chat.ai') + '\n\n' + outlineToMarkdown(data) + '\n---\n\n';
            return;
          }
        } catch(e) {}
        md += '## ' + t('chat.ai') + '\n\n' + raw + '\n\n---\n\n';
      } else {
        const raw = assistantIdx < assistantEntries.length
          ? assistantEntries[assistantEntries].content
          : stripHtml(msg.content);
        assistantIdx++;
        md += '## ' + t('chat.ai') + '\n\n' + raw + '\n\n---\n\n';
      }
    }
  });
```

Wait — `outlineToMarkdown` is inside the IIFE and not exposed to global scope. We need to expose it.

- [ ] **Step 2: Expose outlineToMarkdown from outline.js**

Add to the global scope exposure at the bottom of `outline.js`:

```javascript
  window.generateOutline = generateOutline;
  window.renderOutlineFromJSON = renderOutlineFromJSON;
  window.outlineToMarkdown = outlineToMarkdown;
```

- [ ] **Step 3: Commit**

```bash
git add side_panel/outline.js side_panel/chat-history.js
git commit -m "feat(export): support outline in Markdown chat export"
```

---

## Task 9: Manual testing checklist

Since there is no automated test framework, manual testing is required.

- [ ] **Step 1: Load the extension**
  - Open `chrome://extensions/`
  - Enable Developer mode
  - Click "Load unpacked" and select the project directory
  - Verify no console errors

- [ ] **Step 2: Test Outline button appears**
  - Open any article webpage
  - Click the extension icon to open side panel
  - Verify 4 quick-action buttons: 总结, 翻译, 关键信息, 大纲

- [ ] **Step 3: Test outline generation**
  - Click the "大纲" button
  - Verify skeleton loading animation appears
  - Verify outline tree renders with collapsible sections
  - Click a section heading — verify it expands to show knowledge card
  - Click again — verify it collapses

- [ ] **Step 4: Test copy and export**
  - Click "复制大纲" — verify clipboard contains Markdown
  - Click "导出 Markdown" — verify file downloads

- [ ] **Step 5: Test chat history**
  - Generate an outline
  - Click history button, then go back
  - Reload the chat from history
  - Verify outline renders correctly (not as raw JSON)

- [ ] **Step 6: Test error cases**
  - Test on a new tab (no page content) — should show error
  - Test on a very short page (< 200 chars) — should show error

- [ ] **Step 7: Test i18n**
  - Switch language to English in settings
  - Verify Outline button text changes
  - Generate outline — verify card labels are in English

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "test: manual testing complete for outline feature"
```
