# 选中文本引用功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现网页选中文本实时引用功能——用户选中文字时侧边栏显示引用预览，发送消息时引用内容作为 prompt 的一部分发给 AI。

**Architecture:** content.js 检测选区变化，通过 service_worker.js 中转（加 forwarded 标记防止无限循环），推送到 side_panel.js。side_panel 管理引用状态、UI 显示和 prompt 集成。

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS, Chrome messaging API

---

### Task 1: content.js — 选区变化检测与防抖推送

**Files:**
- Modify: `content.js`

在现有 `chrome.runtime.onMessage.addListener` 之后，添加 `selectionchange` 监听器。300ms 防抖，获取选中文本后通过 `chrome.runtime.sendMessage` 发送给 service worker。

- [ ] **Step 1: 在 content.js 末尾添加选区监听代码**

在 `content.js` 的 `chrome.runtime.onMessage.addListener` 代码块之后追加：

```js
// 选区变化监听（防抖推送）
let selectionTimer = null;

document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    const text = window.getSelection().toString().trim();
    chrome.runtime.sendMessage({
      action: 'selectionChanged',
      text: text
    }).catch(() => {
      // side panel 未打开时 sendMessage 会报错，静默忽略
    });
  }, 300);
});
```

- [ ] **Step 2: 手动验证**

在 `chrome://extensions/` 重新加载扩展，打开任意网页，选中文字。在 `chrome://extensions/` 的 service worker 控制台检查是否有消息发送（可临时加 console.log 验证）。

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "feat: add selectionchange listener with debounce in content.js"
```

---

### Task 2: service_worker.js — 选区消息中转（防递归）

**Files:**
- Modify: `service_worker.js`

在现有 `chrome.runtime.onConnect` 监听器之后，添加 `chrome.runtime.onMessage` 监听器，将 `selectionChanged` 消息转发给 side panel。**必须用 `forwarded` 标记防止 service worker 收到自己转发的消息形成无限循环。**

- [ ] **Step 1: 在 service_worker.js 末尾添加消息中转代码**

在 `chrome.runtime.onConnect.addListener` 代码块之后追加：

```js
// 中转选区变化消息给 side panel
// 注意：必须检查 !msg.forwarded，否则 service worker 会收到自己转发的消息导致无限循环
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'selectionChanged' && !msg.forwarded) {
    chrome.runtime.sendMessage({
      action: 'selectionChanged',
      text: msg.text,
      tabId: sender.tab?.id,
      forwarded: true
    }).catch(() => {
      // side panel 未打开时 sendMessage 会报错，静默忽略
    });
  }
});
```

- [ ] **Step 2: 手动验证**

重新加载扩展，打开 side panel，在页面选中文字，在 side panel 控制台（右键检查）临时添加 `chrome.runtime.onMessage.addListener(console.log)` 确认消息到达且不会无限打印。

- [ ] **Step 3: Commit**

```bash
git add service_worker.js
git commit -m "feat: relay selectionChanged messages to side panel"
```

---

### Task 3: side_panel.html + side_panel.css — 引用预览条 UI

**Files:**
- Modify: `side_panel/side_panel.html`
- Modify: `side_panel/side_panel.css`

在输入框上方添加引用预览条 HTML 和对应样式。

- [ ] **Step 1: 在 side_panel.html 的 `.input-area` 内添加引用预览条**

在 `<div class="input-area">` 内部、`<div class="input-wrapper">` 之前插入：

```html
<div id="quotePreview" class="quote-preview hidden">
  <span class="quote-text" id="quoteText"></span>
  <button class="quote-close" id="quoteClose" title="清除引用" aria-label="清除引用">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  </button>
</div>
```

- [ ] **Step 2: 在 side_panel.css 末尾添加引用预览条样式**

```css
/* 引用预览条 */
.quote-preview {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 12px;
  background: var(--primary-light);
  border-left: 3px solid var(--primary);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.quote-preview.hidden {
  display: none;
}

.quote-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.quote-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.quote-close:hover {
  color: var(--text);
  background: rgba(0, 0, 0, 0.06);
}

/* 用户消息中的引用预览 */
.quote-in-bubble {
  border-left: 3px solid rgba(255, 255, 255, 0.5);
  padding-left: 8px;
  margin-bottom: 6px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
}
```

- [ ] **Step 3: 手动验证**

重新加载扩展，在 side panel 检查引用预览条默认隐藏。在控制台执行 `document.getElementById('quotePreview').classList.remove('hidden')` 确认样式正确。

- [ ] **Step 4: Commit**

```bash
git add side_panel/side_panel.html side_panel/side_panel.css
git commit -m "feat: add quote preview bar UI above input box"
```

---

### Task 4: side_panel.js — 接收选区消息与状态管理

**Files:**
- Modify: `side_panel/side_panel.js`

添加 `selectedText` 状态变量、`activeTabId` 跟踪（含初始化）、消息监听器、引用预览 UI 更新逻辑。

- [ ] **Step 1: 添加状态变量**

在文件顶部的变量声明区域（`let currentChatId = null;` 之后）添加：

```js
// 选中的引用文本
let selectedText = '';
// 当前关联的标签页 ID
let activeTabId = null;
```

- [ ] **Step 2: 获取 DOM 引用**

在现有 DOM 引用的最后一个（`const actionBtns = ...` 之后）添加：

```js
const quotePreview = document.getElementById('quotePreview');
const quoteText = document.getElementById('quoteText');
const quoteClose = document.getElementById('quoteClose');
```

- [ ] **Step 3: 初始化 activeTabId**

在变量声明区域之后、事件绑定之前，添加初始化代码，确保 side panel 打开时就拿到当前 tab：

```js
// 初始化：获取当前标签页 ID
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) activeTabId = tabs[0].id;
});
```

- [ ] **Step 4: 在 extractPageContent 中更新 activeTabId**

在 `extractPageContent()` 函数中，`const [tab] = await chrome.tabs.query(...)` 之后添加 `activeTabId = tab.id;`：

```js
async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('无法获取当前标签页');

  activeTabId = tab.id;
  // ... 其余不变
}
```

- [ ] **Step 5: 添加选区消息监听和 UI 更新函数**

在事件绑定区域（`userInput.addEventListener('input', ...)` 之后）添加：

```js
// 监听选区变化消息（经由 service_worker 中转）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'selectionChanged') {
    // 只处理当前关联 tab 的消息
    if (activeTabId && msg.tabId && msg.tabId !== activeTabId) return;
    updateQuotePreview(msg.text);
  }
});

// 更新引用预览 UI
function updateQuotePreview(text) {
  selectedText = text;
  if (text) {
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    quoteText.textContent = truncated;
    quotePreview.classList.remove('hidden');
  } else {
    quoteText.textContent = '';
    quotePreview.classList.add('hidden');
  }
}

// 清除引用按钮
quoteClose.addEventListener('click', () => {
  updateQuotePreview('');
});
```

- [ ] **Step 6: 在新建聊天时清除引用**

在 `newChatBtn.addEventListener('click', ...)` 回调中，`chatArea.innerHTML = '...'` 之前添加 `updateQuotePreview('');`：

```js
newChatBtn.addEventListener('click', () => {
  if (isGenerating) return;
  saveCurrentChat();
  pageContent = '';
  pageExcerpt = '';
  pageTitle = '';
  conversationHistory = [];
  currentChatId = null;
  updateQuotePreview('');
  chatArea.innerHTML = '<div class="welcome-msg"><p>打开任意网页，点击上方按钮或输入问题开始使用。</p></div>';
});
```

- [ ] **Step 7: 在加载历史会话时清除引用**

在 `loadChat()` 函数中，`pageTitle = chat.pageTitle || '';` 之后添加 `updateQuotePreview('');`：

```js
async function loadChat(id) {
  // ...
  currentChatId = chat.id;
  pageTitle = chat.pageTitle || '';
  pageContent = '';
  pageExcerpt = '';
  updateQuotePreview('');  // 加载历史会话时清除引用
  conversationHistory = chat.conversationHistory || [];
  // ...
}
```

- [ ] **Step 8: 手动验证**

重新加载扩展，打开 side panel 和一个网页。选中文字，确认引用预览条出现并显示截断文本。取消选中，确认预览条消失。点击 ✕ 按钮，确认清除生效。加载一个历史会话，确认引用被清除。

- [ ] **Step 9: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat: receive selection messages and manage quote state"
```

---

### Task 5: side_panel.js — Prompt 集成与聊天气泡渲染

**Files:**
- Modify: `side_panel/side_panel.js`

修改 `sendMessage()` 插入虚拟 user/assistant 对，修改用户消息渲染支持引用预览。

> **注意：历史持久化限制** — `getDisplayMessages()` 使用 `textContent` 提取用户消息，带引用的 innerHTML 消息在持久化时会把引用和问题合并为纯文本。加载历史时用户能看到完整内容，但无法区分引用和问题的结构。这是可接受的权衡。

- [ ] **Step 1: 替换 sendMessage 中的 appendMessage 调用**

**删除** `sendMessage()` 中现有的 `appendMessage('user', text);`（约第 403 行），**替换**为带引用判断的版本：

```js
    // 如果有引用，在用户消息中显示引用预览
    if (selectedText) {
      const truncated = selectedText.length > 50
        ? selectedText.slice(0, 50) + '...'
        : selectedText;
      appendMessageWithQuote(truncated, text);
      // 发送后清除引用
      updateQuotePreview('');
    } else {
      appendMessage('user', text);
    }
```

- [ ] **Step 2: 修改 sendMessage 中的 messages 构建**

在 `sendMessage()` 中，`// 加入历史对话` 注释之前，插入引用上下文。将现有的：

```js
    // 加入历史对话
    messages.push(...conversationHistory);
```

替换为：

```js
    // 插入引用上下文（虚拟 user/assistant 对，不加入 conversationHistory）
    if (selectedText) {
      const quoteLen = 2000;
      const quote = selectedText.length > quoteLen
        ? selectedText.slice(0, quoteLen) + '\n\n[引用内容过长，已截断]'
        : selectedText;
      messages.push({
        role: 'user',
        content: `以下是用户从页面中引用的内容：\n\n${quote}`
      });
      messages.push({
        role: 'assistant',
        content: '好的，我已收到引用内容。请问您有什么问题？'
      });
    }

    // 加入历史对话
    messages.push(...conversationHistory);
```

- [ ] **Step 3: 添加 appendMessageWithQuote 函数**

在 UI 辅助函数区域（`function appendMessage(...)` 之后）添加：

```js
function appendMessageWithQuote(quoteStr, userText) {
  const welcome = chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'message message-user';
  div.innerHTML = `<blockquote class="quote-in-bubble">${escapeHtml(quoteStr)}</blockquote><span>${escapeHtml(userText)}</span>`;

  chatArea.appendChild(div);
  scrollToBottom();
  return div;
}
```

- [ ] **Step 4: 手动验证**

重新加载扩展，打开网页并选中一段文字。确认引用预览条出现。输入问题并发送，确认：
1. 用户气泡中引用预览正确显示
2. AI 回复基于引用内容回答
3. 发送后引用预览条消失
4. 后续消息不带引用上下文

- [ ] **Step 5: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat: integrate quote into prompt and user message bubble"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 完整流程测试**

1. 在 `chrome://extensions/` 重新加载扩展
2. 打开一篇中文文章（如知乎/掘金）
3. 不选中文字 → 输入框上方无引用条 → 输入问题发送 → AI 基于全文回答（正常行为不变）
4. 选中一段文字 → 引用预览条出现，显示前 50 字 → 输入问题发送 → 用户气泡显示引用预览 + 问题 → AI 优先基于引用回答
5. 取消选中 → 引用预览条消失 → 再发消息 → 不带引用（正常行为）
6. 选中文字 → 点击 ✕ → 引用消失 → 发消息不带引用
7. 选中文字 → 点击快捷操作（总结/翻译/关键信息）→ 快捷操作不受引用影响
8. 新建聊天 → 引用清除
9. 选中文字 → 发送消息 → 打开历史面板 → 加载其他历史会话 → 引用已清除

- [ ] **Step 2: 更新 TODO.md**

在 `TODO.md` 的待实现区域添加此功能为已完成。

- [ ] **Step 3: Final commit**

```bash
git add TODO.md
git commit -m "docs: mark selection quote feature as completed in TODO"
```
