# 动态模型选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `deepseek-chat` model with dynamic model selection fetched from the OpenAI-compatible `/models` API, with a model status bar in the side panel.

**Architecture:** Settings page gets a model selector using `<input>` + `<datalist>`. Model list is fetched via service worker (CORS-safe relay). Service worker reads `modelName` from storage on each API call. Side panel shows current model in a bottom status bar.

**Tech Stack:** Vanilla JS, Chrome Extension APIs (storage.sync, runtime messaging), HTML5 `<datalist>`, OpenAI-compatible `/models` endpoint.

**Spec:** `docs/superpowers/specs/2026-03-29-dynamic-model-selection-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `service_worker.js` | Modify | Add `fetchModels` message handler; read `modelName` in `callOpenAI` |
| `options/options.html` | Modify | Add model selector form group (input + datalist + refresh button) |
| `options/options.css` | Modify | Style model selector area (inline layout, refresh button) |
| `options/options.js` | Modify | Fetch models via service worker, populate datalist, save modelName |
| `side_panel/side_panel.html` | Modify | Add model status bar inside `.input-area` |
| `side_panel/side_panel.css` | Modify | Style model status bar (small, gray, centered) |
| `side_panel/side_panel.js` | Modify | Read and display model name, listen for changes |

---

### Task 1: Service worker — fetchModels handler

**Files:**
- Modify: `service_worker.js`

- [ ] **Step 1: Add fetchModels handler to existing onMessage listener**

The existing `selectionChanged` handler (lines 92–103) is a single `chrome.runtime.onMessage.addListener`. Add the `fetchModels` case as an additional branch in this same listener. Replace lines 92–103 with:

```javascript
// 消息处理：选区变化中转 + 模型列表请求
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

  if (msg.action === 'fetchModels') {
    const baseUrl = msg.apiBase || 'https://api.deepseek.com';

    fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${msg.apiKey}`
      }
    })
    .then(res => {
      if (!res.ok) throw new Error(`获取模型列表失败 (${res.status})`);
      return res.json();
    })
    .then(data => {
      const models = (data.data || []).map(m => m.id);
      sendResponse({ success: true, models });
    })
    .catch(e => {
      sendResponse({ success: false, error: e.message });
    });

    // 返回 true 表示异步发送 sendResponse
    return true;
  }
});
```

- [ ] **Step 2: Update callOpenAI to read modelName from storage**

Replace line 10 (`const { apiKey, apiBase } = await chrome.storage.sync.get(['apiKey', 'apiBase']);`) with:

```javascript
const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);
```

Replace line 27 (`model: 'deepseek-chat',`) with:

```javascript
model: modelName || 'deepseek-chat',
```

- [ ] **Step 3: Commit**

```bash
git add service_worker.js
git commit -m "feat: add fetchModels handler and dynamic model name in service worker"
```

---

### Task 2: Options page — model selector UI

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.css`

- [ ] **Step 1: Add model selector form group to options.html**

Insert between the `apiBase` form group (after line 23 `</div>`) and the `systemPrompt` form group (line 25 `<div class="form-group">`):

```html
    <div class="form-group">
      <label for="modelName">模型名称</label>
      <div class="model-input-row">
        <input type="text" id="modelName" list="model-list" placeholder="点击刷新按钮获取可用模型，或手动输入模型名称">
        <button id="refreshModelsBtn" class="refresh-btn" type="button">刷新模型列表</button>
      </div>
      <datalist id="model-list"></datalist>
      <p class="hint">选择或输入要使用的模型名称。点击刷新按钮从当前 API 地址获取可用模型列表。</p>
    </div>
```

- [ ] **Step 2: Add model selector styles to options.css**

Append to the end of `options/options.css`:

```css
.model-input-row {
  display: flex;
  gap: 8px;
}

.model-input-row input {
  flex: 1;
}

.refresh-btn {
  flex-shrink: 0;
  padding: 10px 14px;
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.refresh-btn:hover {
  background: #4338ca;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Commit**

```bash
git add options/options.html options/options.css
git commit -m "feat: add model selector UI to options page"
```

---

### Task 3: Options page — model fetch and save logic

**Depends on:** Task 1 (service worker must have fetchModels handler), Task 2 (HTML must have model selector elements)

**Files:**
- Modify: `options/options.js`

- [ ] **Step 1: Add modelName references and auto-fetch on load**

Replace the top section (lines 1–20) with:

```javascript
// options.js — 设置页逻辑

const apiKeyInput = document.getElementById('apiKey');
const apiBaseInput = document.getElementById('apiBase');
const modelNameInput = document.getElementById('modelName');
const modelList = document.getElementById('model-list');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const systemPromptInput = document.getElementById('systemPrompt');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// 加载已保存的设置
chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName', 'systemPrompt'], (data) => {
  if (data.apiKey) {
    apiKeyInput.value = data.apiKey;
  }
  if (data.apiBase) {
    apiBaseInput.value = data.apiBase;
  }
  if (data.modelName) {
    modelNameInput.value = data.modelName;
  }
  if (data.systemPrompt) {
    systemPromptInput.value = data.systemPrompt;
  }
  // 有 apiKey 时自动获取模型列表
  if (data.apiKey) {
    fetchModels();
  }
});
```

- [ ] **Step 2: Add fetchModels function and refresh button handler**

Insert after the `chrome.storage.sync.get` block (before the save event listener):

```javascript
// 获取模型列表（通过 service worker 中转）
async function fetchModels() {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || 'https://api.deepseek.com';

  if (!apiKey) {
    showStatus('请先填写 API Key', 'error');
    return;
  }

  refreshModelsBtn.disabled = true;
  refreshModelsBtn.textContent = '加载中...';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'fetchModels',
      apiBase,
      apiKey
    });

    modelList.innerHTML = '';
    if (response.success) {
      response.models.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        modelList.appendChild(option);
      });
      showStatus(`已获取 ${response.models.length} 个模型`, 'success');
    } else {
      showStatus(response.error || '获取模型列表失败', 'error');
    }
  } catch (e) {
    modelList.innerHTML = '';
    showStatus('获取模型列表失败：' + e.message, 'error');
  } finally {
    refreshModelsBtn.disabled = false;
    refreshModelsBtn.textContent = '刷新模型列表';
  }
}

refreshModelsBtn.addEventListener('click', fetchModels);
```

- [ ] **Step 3: Update save handler to include modelName**

Replace the save event listener (lines 23–55) with:

```javascript
// 保存设置
saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim();
  const modelName = modelNameInput.value.trim();
  const systemPrompt = systemPromptInput.value.trim();

  if (!apiKey) {
    showStatus('请输入 API Key', 'error');
    return;
  }

  if (!apiKey.startsWith('sk-') && !apiBase) {
    showStatus('提示：标准 OpenAI Key 以 sk- 开头。如使用第三方 API，请同时填写 API 地址', 'error');
    return;
  }

  const data = { apiKey };
  if (apiBase) {
    data.apiBase = apiBase;
  } else {
    chrome.storage.sync.remove('apiBase');
  }

  if (modelName) {
    data.modelName = modelName;
  } else {
    chrome.storage.sync.remove('modelName');
  }

  if (systemPrompt) {
    data.systemPrompt = systemPrompt;
  } else {
    chrome.storage.sync.remove('systemPrompt');
  }

  chrome.storage.sync.set(data, () => {
    showStatus('设置已保存', 'success');
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add options/options.js
git commit -m "feat: add model list fetching and modelName saving to options"
```

---

### Task 4: Side panel — model status bar

**Files:**
- Modify: `side_panel/side_panel.html`
- Modify: `side_panel/side_panel.css`
- Modify: `side_panel/side_panel.js`

- [ ] **Step 1: Add status bar HTML to side_panel.html**

Insert after the `.input-wrapper` div (after line 93, before the closing `</div>` of `.input-area`):

```html
      <div id="modelStatusBar" class="model-status-bar">当前模型：deepseek-chat</div>
```

- [ ] **Step 2: Add status bar styles to side_panel.css**

Append to the end of `side_panel/side_panel.css`:

```css
/* 模型状态栏 */
.model-status-bar {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 0 2px;
  user-select: none;
}
```

- [ ] **Step 3: Add model name display logic to side_panel.js**

Add at the end of the file:

```javascript
// === 模型状态栏 ===

const modelStatusBar = document.getElementById('modelStatusBar');

function updateModelStatusBar(name) {
  modelStatusBar.textContent = '当前模型：' + (name || 'deepseek-chat');
}

// 加载时读取模型名称
chrome.storage.sync.get(['modelName'], (data) => {
  updateModelStatusBar(data.modelName);
});

// 监听模型名称变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.modelName) {
    updateModelStatusBar(changes.modelName.newValue);
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add side_panel/side_panel.html side_panel/side_panel.css side_panel/side_panel.js
git commit -m "feat: add model status bar to side panel"
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Depends on:** Task 1, 2, 3, 4

- [ ] **Step 1: Update storage docs**

In the "Communication patterns → Settings" section, update the storage keys list. Change `apiKey`/`apiBase`/`systemPrompt` to include `modelName`.

Find:
```
- **Settings**: `chrome.storage.sync` for `apiKey`, `apiBase`, and `systemPrompt`
```

Replace with:
```
- **Settings**: `chrome.storage.sync` for `apiKey`, `apiBase`, `modelName`, and `systemPrompt`
```

- [ ] **Step 2: Update service_worker.js description**

In the "Key files" table, update the `service_worker.js` row to mention model name handling. Find `Model name (\`deepseek-chat\`) is hardcoded here` and replace with `Reads model name from storage, defaults to \`deepseek-chat\``.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with modelName storage field"
```

---

### Task 6: Final commit and cleanup

- [ ] **Step 1: Verify all changes are committed**

```bash
git status
git log --oneline -5
```

Expected: 4 new commits on top of the spec commit, clean working tree.

- [ ] **Step 2: Manual test checklist**

Load the extension in Chrome and verify:
1. Open settings page — model name input and refresh button visible
2. Enter API Key, click "刷新模型列表" — models populate in datalist
3. Select a model, save — no errors
4. Open side panel — status bar shows selected model name
5. Send a chat message — response uses the selected model
6. Change model in settings — side panel status bar updates in real-time
7. Clear model name, save — status bar shows "当前模型：deepseek-chat"
