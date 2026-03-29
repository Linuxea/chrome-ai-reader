# AI 推荐追问功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 回复后自动生成 3 个引导性后续问题，用户点击即可发送，帮助深入探索网页内容。

**Architecture:** 通过 `chrome.runtime.connect({ name: 'suggest-questions' })` 长连接通道流式获取推荐问题，复用现有 port 模式。推荐问题作为独立 DOM 元素渲染在 AI 气泡外部下方，不记入对话历史。

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3, CSS custom properties, OpenAI-compatible streaming API

**Spec:** `docs/superpowers/specs/2026-03-29-suggest-questions-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `side_panel/side_panel.css` | Modify | 新增 `.suggest-questions`、`.suggest-item`、`.suggest-loading` 样式 |
| `side_panel/side_panel.js` | Modify | 新增状态变量、`generateSuggestions()`、`removeSuggestQuestions()`、清理逻辑、storage 监听 |
| `service_worker.js` | Modify | 新增 `suggest-questions` port 监听和 `callSuggestQuestions()` |
| `options/options.html` | Modify | 新增推荐追问 `<details>` 面板 |
| `options/options.css` | Modify | 新增 toggle switch CSS 样式 |
| `options/options.js` | Modify | 处理 toggle 开关、导出导入集成 |

---

### Task 1: CSS — 推荐问题样式 + 设置页 toggle 开关样式

**Files:**
- Modify: `side_panel/side_panel.css` (末尾追加)
- Modify: `options/options.css` (末尾追加)

- [ ] **Step 1: 在 `side_panel/side_panel.css` 末尾追加推荐问题样式**

在文件末尾（`@keyframes tts-wave` 之后）追加：

```css
/* 推荐追问 */
.suggest-questions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  align-self: flex-start;
  max-width: 90%;
}

.suggest-item {
  padding: 6px 12px;
  border: 1px solid var(--primary);
  border-radius: 16px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  line-height: 1.4;
}

.suggest-item:hover {
  background: var(--primary);
  color: #fff;
}

.suggest-loading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-self: flex-start;
  max-width: 90%;
}

.suggest-loading-bar {
  height: 18px;
  border-radius: 9px;
  background: var(--border);
  animation: suggest-pulse 1.5s ease-in-out infinite;
}

.suggest-loading-bar:nth-child(1) { width: 120px; }
.suggest-loading-bar:nth-child(2) { width: 90px; animation-delay: 0.2s; }
.suggest-loading-bar:nth-child(3) { width: 140px; animation-delay: 0.4s; }

@keyframes suggest-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
```

- [ ] **Step 2: 在 `options/options.css` 末尾追加 toggle switch 样式**

在文件末尾（`.config-fields` 规则之后）追加：

```css
/* Toggle 开关 */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  cursor: pointer;
  font-size: 14px;
  color: #374151;
}

.toggle-row input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 40px;
  height: 22px;
  background: #d1d5db;
  border: none;
  border-radius: 11px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-row input[type="checkbox"]::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}

.toggle-row input[type="checkbox"]:checked {
  background: #4f46e5;
}

.toggle-row input[type="checkbox"]:checked::after {
  transform: translateX(18px);
}
```

- [ ] **Step 3: Commit**

```bash
git add side_panel/side_panel.css options/options.css
git commit -m "feat: add CSS styles for suggested questions and toggle switch"
```

---

### Task 2: service_worker — 新增 suggest-questions port 通道

**Files:**
- Modify: `service_worker.js`

- [ ] **Step 1: 在 `service_worker.js` 的 `callTTS` 函数之后、`chrome.runtime.onConnect` 监听器之前，新增 `callSuggestQuestions` 函数**

```javascript
// 生成推荐追问（流式）
async function callSuggestQuestions(messages, port) {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);

  if (!apiKey) {
    port.postMessage({ type: 'error', error: '未配置 API Key，无法生成推荐问题' });
    return;
  }

  const baseUrl = apiBase || 'https://api.deepseek.com';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName || 'deepseek-chat',
        messages: messages,
        stream: true,
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API 请求失败 (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          port.postMessage({ type: 'done' });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            port.postMessage({ type: 'chunk', content: delta.content });
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    port.postMessage({ type: 'done' });
  } catch (e) {
    port.postMessage({ type: 'error', error: e.message });
  }
}
```

- [ ] **Step 2: 在 `chrome.runtime.onConnect` 监听器中，`tts` 分支之后添加 `suggest-questions` 分支**

在现有 `} else if (port.name === 'tts') { ... }` 块之后添加：

```javascript
  } else if (port.name === 'suggest-questions') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'suggest') {
        await callSuggestQuestions(msg.messages, port);
      }
    });
  }
```

- [ ] **Step 3: Commit**

```bash
git add service_worker.js
git commit -m "feat: add suggest-questions port handler in service worker"
```

---

### Task 3: side_panel — 推荐问题核心逻辑

**Files:**
- Modify: `side_panel/side_panel.js`

这是核心任务，包含状态变量、生成函数、清理逻辑和存储监听。

- [ ] **Step 1: 新增状态变量**

在 `side_panel.js` 顶部的 TTS 状态变量块之后（`let ttsBufferAppending = false;` 之后）追加：

```javascript
// 推荐追问状态
let suggestQuestionsEnabled = true;
```

- [ ] **Step 2: 初始化时读取开关状态**

在现有的 `chrome.storage.sync.get(['systemPrompt'])` 调用之后（`side_panel.js:89-93`），追加：

```javascript
// 加载推荐追问开关
chrome.storage.sync.get(['suggestQuestions'], (data) => {
  suggestQuestionsEnabled = data.suggestQuestions !== false;
});
```

- [ ] **Step 3: 扩展 storage.onChanged 监听器**

在现有的 `chrome.storage.onChanged` 监听器中（`side_panel.js:612-621`），在 `if (changes.systemPrompt)` 块之后追加：

```javascript
    if (changes.suggestQuestions) {
      suggestQuestionsEnabled = changes.suggestQuestions.newValue !== false;
    }
```

- [ ] **Step 4: 新增 `removeSuggestQuestions` 和 `generateSuggestions` 函数**

在 `addTTSButton` 函数之后、模型状态栏代码之前（`side_panel.js:597` 附近）插入：

```javascript
// === 推荐追问 ===

// 移除当前显示的推荐问题区域
function removeSuggestQuestions() {
  const el = chatArea.querySelector('.suggest-questions, .suggest-loading');
  if (el) el.remove();
}

// 生成推荐追问
function generateSuggestions(msgEl, history) {
  if (!suggestQuestionsEnabled) return;

  // 显示骨架加载态
  const loadingEl = document.createElement('div');
  loadingEl.className = 'suggest-loading';
  loadingEl.innerHTML = `
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
  `;
  msgEl.after(loadingEl);

  // 构建发给 API 的消息（取最近 2 轮对话）
  const recentHistory = history.slice(-4); // 2 轮 = 4 条消息 (user, assistant, user, assistant)
  const userMessages = recentHistory.filter(m => m.role === 'user');
  const assistantMessages = recentHistory.filter(m => m.role === 'assistant');

  let userContent = '';
  const lastUser = userMessages[userMessages.length - 1];
  if (lastUser) userContent += '用户问题：' + lastUser.content + '\n\n';

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const truncated = lastAssistant.content.length > 2000
      ? lastAssistant.content.slice(0, 2000) + '...'
      : lastAssistant.content;
    userContent += 'AI 回复：' + truncated;
  }

  const messages = [
    {
      role: 'system',
      content: '你是一个阅读助手。基于对话历史，生成 3 个有深度的后续问题，帮助用户更深入地理解文章内容。每行一个问题，不要编号，不要额外解释。'
    },
    { role: 'user', content: userContent }
  ];

  const port = chrome.runtime.connect({ name: 'suggest-questions' });

  port.onDisconnect.addListener(() => {
    // port 断开时清理骨架
    if (loadingEl.parentNode) loadingEl.remove();
  });

  let fullText = '';

  port.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      fullText += msg.content;
    } else if (msg.type === 'done') {
      port.disconnect();
      // 解析问题列表
      const questions = fullText
        .split('\n')
        .map(q => q.replace(/^[\d]+[.、)\s]*/, '').trim()) // 移除可能的编号
        .filter(q => q.length > 0)
        .slice(0, 3);

      // 移除骨架
      if (loadingEl.parentNode) loadingEl.remove();

      if (questions.length === 0) return;

      // 渲染推荐问题
      const suggestEl = document.createElement('div');
      suggestEl.className = 'suggest-questions';

      questions.forEach(q => {
        const item = document.createElement('button');
        item.className = 'suggest-item';
        item.textContent = q;
        item.addEventListener('click', () => {
          // 移除推荐区域
          suggestEl.remove();
          // 填入并发送
          userInput.value = q;
          sendMessage();
        });
        suggestEl.appendChild(item);
      });

      msgEl.after(suggestEl);
      smartScrollToBottom();
    } else if (msg.type === 'error') {
      port.disconnect();
      // 静默失败，移除骨架
      if (loadingEl.parentNode) loadingEl.remove();
    }
  });

  port.postMessage({ type: 'suggest', messages });
}
```

- [ ] **Step 5: 在 `callAI` 的 `done` 回调中触发推荐问题生成**

在 `callAI` 函数内 `msg.type === 'done'` 分支中，`saveCurrentChat()` 之后（`side_panel.js:432` 附近）追加：

```javascript
      // 生成推荐追问
      generateSuggestions(msgEl, conversationHistory);
```

- [ ] **Step 6: 在 `sendToAI` 顶部清除旧的推荐问题区域**

在 `sendToAI` 函数中，`const quoteForContext = selectedText;` 之前（`side_panel.js:294` 附近）插入：

```javascript
  removeSuggestQuestions();
```

- [ ] **Step 7: 在新建聊天时清除推荐问题区域**

在 `newChatBtn` 的 click handler 中（`side_panel.js:111` 附近），`pageContent = '';` 之前插入：

```javascript
    removeSuggestQuestions();
```

- [ ] **Step 8: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat: add generateSuggestions with streaming port and UI rendering"
```

---

### Task 4: options — 设置页 toggle 开关与导出导入集成

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`

- [ ] **Step 1: 在 `options.html` 中插入推荐追问面板**

在 TTS 配置 `</details>` 之后、`<button id="saveBtn">` 之前，插入：

```html
      <!-- 推荐追问 -->
      <details class="config-details">
        <summary class="config-summary">推荐追问</summary>
        <div class="config-fields">
          <label class="toggle-row">
            <span>AI 回复后自动生成推荐问题</span>
            <input type="checkbox" id="suggestQuestions" checked>
          </label>
        </div>
      </details>
```

- [ ] **Step 2: 在 `options.js` 中添加 toggle 相关逻辑**

2a. 在 `const SYNC_FIELDS` 数组中追加 `'suggestQuestions'`：

```javascript
const SYNC_FIELDS = ['apiKey', 'apiBase', 'modelName', 'systemPrompt', 'ttsAppId', 'ttsAccessKey', 'ttsResourceId', 'ttsSpeaker', 'suggestQuestions'];
```

2b. 在 TTS 配置变量声明之后（`const ttsSpeakerInput = ...` 之后），追加：

```javascript
// 推荐追问
const suggestQuestionsCheckbox = document.getElementById('suggestQuestions');
```

2c. 在 `chrome.storage.sync.get(SYNC_FIELDS, ...)` 回调中，`fieldInputMap` 循环之后追加：

```javascript
    // 推荐追问（checkbox，不通过 fieldInputMap 处理）
    if (data.suggestQuestions !== undefined) {
      suggestQuestionsCheckbox.checked = data.suggestQuestions;
    }
```

2d. 在 `refreshModelsBtn` 事件监听器之后，追加 toggle 实时保存逻辑：

```javascript
// 推荐追问开关 — 实时保存
suggestQuestionsCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({ suggestQuestions: suggestQuestionsCheckbox.checked });
});
```

2e. 在导入逻辑（`importFile.addEventListener('change', ...)` 回调）中，在 `for (const key of SYNC_FIELDS)` 循环中，将赋值逻辑改为跳过 `suggestQuestions`：

将循环体从：
```javascript
      for (const key of SYNC_FIELDS) {
        if (data[key]) {
          syncData[key] = data[key];
          fieldInputMap[key].value = data[key];
        }
      }
```

改为：
```javascript
      for (const key of SYNC_FIELDS) {
        if (key === 'suggestQuestions') continue; // 单独处理
        if (data[key]) {
          syncData[key] = data[key];
          fieldInputMap[key].value = data[key];
        }
      }

      // 推荐追问单独处理（checkbox 而非 text input）
      if (data.suggestQuestions !== undefined) {
        syncData.suggestQuestions = data.suggestQuestions;
        suggestQuestionsCheckbox.checked = data.suggestQuestions;
      } else {
        syncData.suggestQuestions = true; // 旧版导出文件默认开启
        suggestQuestionsCheckbox.checked = true;
      }
```

2f. 在清除未导入字段的循环中，也跳过 `suggestQuestions`（因为它有默认值，不应被移除）：

将：
```javascript
      SYNC_FIELDS.forEach(f => {
        if (!(f in data)) chrome.storage.sync.remove(f);
      });
```

改为：
```javascript
      SYNC_FIELDS.forEach(f => {
        if (f === 'suggestQuestions') return; // 保留默认值，不删除
        if (!(f in data)) chrome.storage.sync.remove(f);
      });
```

- [ ] **Step 3: Commit**

```bash
git add options/options.html options/options.js
git commit -m "feat: add suggest-questions toggle in settings with export/import support"
```

---

### Task 5: 手动验证

此项目无自动化测试框架，需手动验证。

- [ ] **Step 1: 在 Chrome 中加载扩展并测试核心流程**

1. 打开 `chrome://extensions/`，点击"重新加载"扩展
2. 打开任意网页，点击扩展图标打开侧边栏
3. 点击"总结"按钮，等待 AI 回复完成
4. 验证：AI 气泡下方出现 3 个推荐问题标签
5. 点击其中一个标签，验证：问题自动发送，AI 回复，旧的推荐区域消失，新推荐出现

- [ ] **Step 2: 验证设置开关**

1. 点击设置按钮进入设置页
2. 展开"推荐追问"面板
3. 关闭开关
4. 返回侧边栏，发送新消息
5. 验证：AI 回复后不再出现推荐问题
6. 回到设置页重新开启

- [ ] **Step 3: 验证导出导入**

1. 设置页点击"导出设置"
2. 打开导出的 JSON 文件，确认包含 `"suggestQuestions": true/false`
3. 修改 JSON 中的值，导入
4. 验证：设置页开关状态正确更新

- [ ] **Step 4: 验证容错**

1. 输入错误的 API Key（无法生成推荐问题）
2. 发送消息，验证：AI 主回复正常（可能也失败），推荐问题区域静默消失
3. 修正 API Key 后恢复正常
