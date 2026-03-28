# 快捷指令功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-configurable quick commands — custom prompt templates accessible via `/` in chat input, managed in settings page.

**Architecture:** Commands stored in `chrome.storage.local` as `quickCommands` array. Settings page provides CRUD UI with real-time save. Side panel detects `/` input, shows filterable popup, executes selected command by extracting page content and sending user's prompt to AI.

**Tech Stack:** Vanilla JS, Chrome Extension APIs (`chrome.storage.local`, `chrome.storage.onChanged`), CSS custom properties.

---

### Task 1: Settings page — HTML structure

**Files:**
- Modify: `options/options.html:35-39` (after `systemPrompt` form-group, before save button)

Add the quick commands section HTML between the systemPrompt form-group and the save button.

- [ ] **Step 1: Add quick commands HTML block to options.html**

Insert after `</div>` that closes the systemPrompt `.form-group` (line 39), before `<button id="saveBtn">` (line 41):

```html
    <div class="form-group">
      <label>快捷指令</label>
      <p class="hint">配置快捷指令后，在聊天框输入 <code>/</code> 即可快速调用。</p>
      <div id="quickCommandsList" class="quick-commands-list"></div>
      <button id="addCommandBtn" class="add-command-btn" type="button">+ 添加指令</button>
    </div>
```

- [ ] **Step 2: Verify HTML renders correctly**

Open `options/options.html` in browser. Should see new "快捷指令" section with empty list area and "+ 添加指令" button.

- [ ] **Step 3: Commit**

```bash
git add options/options.html
git commit -m "feat: add quick commands HTML structure to settings page"
```

---

### Task 2: Settings page — CSS styles

**Files:**
- Modify: `options/options.css` (append at end)

- [ ] **Step 1: Add quick command styles to options.css**

Append after existing styles:

```css
/* 快捷指令管理 */
.quick-commands-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.quick-command-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  gap: 8px;
}

.quick-command-info {
  flex: 1;
  min-width: 0;
}

.quick-command-name {
  font-size: 14px;
  font-weight: 500;
}

.quick-command-preview {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-command-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s;
}

.quick-command-btn:hover {
  color: #4f46e5;
}

.quick-command-btn.delete:hover {
  color: #dc2626;
}

.quick-command-edit-form {
  padding: 10px 0 0;
  border-top: 1px solid #e5e7eb;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-command-edit-form input {
  font-size: 13px;
  padding: 8px 10px;
}

.quick-command-edit-form textarea {
  font-size: 13px;
  padding: 8px 10px;
  min-height: 80px;
}

.quick-command-edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.quick-command-edit-actions button {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #1a1a2e;
  transition: border-color 0.15s;
}

.quick-command-edit-actions .save-edit-btn {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}

.quick-command-edit-actions .save-edit-btn:hover {
  background: #4338ca;
}

.quick-command-edit-actions .cancel-edit-btn:hover {
  border-color: #4f46e5;
}

.add-command-btn {
  width: 100%;
  padding: 8px;
  background: none;
  border: 1px dashed #e5e7eb;
  border-radius: 8px;
  color: #6b7280;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.add-command-btn:hover {
  border-color: #4f46e5;
  color: #4f46e5;
}

.quick-commands-empty {
  text-align: center;
  color: #6b7280;
  font-size: 13px;
  padding: 12px 0;
}
```

- [ ] **Step 2: Verify styles**

Reload options page. Empty state should look clean with styled "+ 添加指令" dashed button.

- [ ] **Step 3: Commit**

```bash
git add options/options.css
git commit -m "feat: add quick command styles to settings page"
```

---

### Task 3: Settings page — CRUD logic in options.js

**Files:**
- Modify: `options/options.js` (append after existing code)

This task adds all CRUD logic: loading from storage, rendering list, inline add/edit/delete forms, validation, and real-time save.

- [ ] **Step 1: Add `escapeHtml` helper (needed by command rendering)**

Append at the end of `options/options.js`, before the quick commands code:

```js
// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] **Step 2: Add quick commands state and DOM refs**

Append at the end of `options/options.js`:

```js
// === 快捷指令管理 ===

const COMMANDS_KEY = 'quickCommands';
const quickCommandsList = document.getElementById('quickCommandsList');
const addCommandBtn = document.getElementById('addCommandBtn');
let editingIndex = -1; // -1 = not editing, -2 = adding new

// Load quick commands from storage
function loadQuickCommands() {
  chrome.storage.local.get([COMMANDS_KEY], (data) => {
    const commands = data[COMMANDS_KEY] || [];
    renderQuickCommands(commands);
  });
}

// Render the command list
function renderQuickCommands(commands) {
  quickCommandsList.innerHTML = '';

  if (commands.length === 0 && editingIndex !== -2) {
    quickCommandsList.innerHTML = '<div class="quick-commands-empty">暂无快捷指令，点击下方按钮添加</div>';
    return;
  }

  commands.forEach((cmd, idx) => {
    if (editingIndex === idx) {
      // Show inline edit form
      quickCommandsList.appendChild(createEditForm(cmd.name, cmd.prompt, idx));
    } else {
      // Show item row
      const item = document.createElement('div');
      item.className = 'quick-command-item';
      const preview = cmd.prompt.length > 50 ? cmd.prompt.slice(0, 50) + '...' : cmd.prompt;
      item.innerHTML = `
        <div class="quick-command-info">
          <div class="quick-command-name">/${escapeHtml(cmd.name)}</div>
          <div class="quick-command-preview">${escapeHtml(preview)}</div>
        </div>
        <button class="quick-command-btn edit-btn" data-idx="${idx}" title="编辑">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="quick-command-btn delete" data-idx="${idx}" title="删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
          </svg>
        </button>
      `;
      quickCommandsList.appendChild(item);
    }
  });

  // If adding new, append form at bottom
  if (editingIndex === -2) {
    quickCommandsList.appendChild(createEditForm('', '', -2));
  }
}

// Create inline edit form
function createEditForm(name, prompt, idx) {
  const form = document.createElement('div');
  form.className = 'quick-command-item';
  form.style.flexDirection = 'column';
  form.style.alignItems = 'stretch';
  form.innerHTML = `
    <div class="quick-command-edit-form">
      <input type="text" class="edit-name" value="${escapeHtml(name)}" placeholder="指令名称（不含空格和/）">
      <textarea class="edit-prompt" rows="3" placeholder="Prompt 内容">${escapeHtml(prompt)}</textarea>
      <div class="quick-command-edit-actions">
        <button class="cancel-edit-btn" type="button">取消</button>
        <button class="save-edit-btn" type="button">保存</button>
      </div>
    </div>
  `;

  const nameInput = form.querySelector('.edit-name');
  const promptInput = form.querySelector('.edit-prompt');

  // Save
  form.querySelector('.save-edit-btn').addEventListener('click', () => {
    const newName = nameInput.value.trim();
    const newPrompt = promptInput.value.trim();

    if (!newName || !newPrompt) {
      showStatus('指令名称和内容不能为空', 'error');
      return;
    }
    if (/[\s/]/.test(newName)) {
      showStatus('指令名称不能包含空格或 /', 'error');
      return;
    }

    chrome.storage.local.get([COMMANDS_KEY], (data) => {
      const commands = data[COMMANDS_KEY] || [];
      // Check uniqueness (excluding current index)
      const duplicate = commands.findIndex((c, i) => c.name === newName && i !== idx);
      if (duplicate !== -1) {
        showStatus('指令名称已存在', 'error');
        return;
      }

      if (idx === -2) {
        commands.push({ name: newName, prompt: newPrompt });
      } else {
        commands[idx] = { name: newName, prompt: newPrompt };
      }
      saveQuickCommands(commands);
      editingIndex = -1;
      renderQuickCommands(commands);
      showStatus('指令已保存', 'success');
    });
  });

  // Cancel
  form.querySelector('.cancel-edit-btn').addEventListener('click', () => {
    editingIndex = -1;
    chrome.storage.local.get([COMMANDS_KEY], (data) => {
      renderQuickCommands(data[COMMANDS_KEY] || []);
    });
  });

  // Auto-focus name input
  setTimeout(() => nameInput.focus(), 0);

  return form;
}

// Save commands to storage (remove key if empty)
function saveQuickCommands(commands) {
  if (commands.length === 0) {
    chrome.storage.local.remove(COMMANDS_KEY);
  } else {
    chrome.storage.local.set({ [COMMANDS_KEY]: commands });
  }
}

// Event delegation for edit/delete buttons
quickCommandsList.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.edit-btn');
  const deleteBtn = e.target.closest('.delete');

  if (editBtn) {
    editingIndex = parseInt(editBtn.dataset.idx);
    chrome.storage.local.get([COMMANDS_KEY], (data) => {
      renderQuickCommands(data[COMMANDS_KEY] || []);
    });
  } else if (deleteBtn) {
    const idx = parseInt(deleteBtn.dataset.idx);
    chrome.storage.local.get([COMMANDS_KEY], (data) => {
      const commands = data[COMMANDS_KEY] || [];
      commands.splice(idx, 1);
      saveQuickCommands(commands);
      editingIndex = -1;
      renderQuickCommands(commands);
      showStatus('指令已删除', 'success');
    });
  }
});

// Add new command
addCommandBtn.addEventListener('click', () => {
  editingIndex = -2;
  chrome.storage.local.get([COMMANDS_KEY], (data) => {
    renderQuickCommands(data[COMMANDS_KEY] || []);
  });
});

// Load on init
loadQuickCommands();
```

- [ ] **Step 3: Test CRUD in browser**

Reload extension → open settings → verify:
1. Empty state shows placeholder text
2. Click "+ 添加指令" shows inline form
3. Fill name + prompt, save → appears in list
4. Click edit → inline form with pre-filled values
5. Click delete → removed from list
6. Delete all → key removed from storage

- [ ] **Step 4: Commit**

```bash
git add options/options.js
git commit -m "feat: add quick commands CRUD logic to settings page"
```

---

### Task 4: Side panel — command popup CSS

**Files:**
- Modify: `side_panel/side_panel.css` (append at end)

- [ ] **Step 1: Add command popup styles**

```css
/* 快捷指令弹出列表 */
.command-popup {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  max-height: 240px;
  overflow-y: auto;
  z-index: 20;
  margin-bottom: 4px;
}

.command-popup.hidden {
  display: none;
}

.command-popup-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  gap: 8px;
  transition: background 0.1s;
}

.command-popup-item:hover,
.command-popup-item.selected {
  background: var(--primary-light);
}

.command-popup-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--primary);
  white-space: nowrap;
}

.command-popup-item-preview {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.command-popup-empty {
  padding: 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}
```

- [ ] **Step 2: Commit**

```bash
git add side_panel/side_panel.css
git commit -m "feat: add command popup styles to side panel"
```

---

### Task 5: Side panel — command popup HTML and JS logic

**Files:**
- Modify: `side_panel/side_panel.html` (add popup container inside input-area)
- Modify: `side_panel/side_panel.js` (add command loading, popup logic, execution)

**Part A: Add popup container to HTML**

- [ ] **Step 1: Add popup element inside `.input-area` in side_panel.html**

Insert before the `.input-wrapper` div (before line 92 `<div class="input-wrapper">`):

```html
      <div id="commandPopup" class="command-popup hidden"></div>
```

Also wrap the `.input-area` with `position: relative` — add to the `.input-area` div:

Actually, the `.input-area` already has styles. We'll add `position: relative` in CSS. The popup HTML just needs to be placed inside `.input-area`, before `.input-wrapper`.

**Part B: Add `position: relative` to `.input-area` in side_panel.css**

- [ ] **Step 2: Add `position: relative` to `.input-area`**

In `side_panel.css`, find the `.input-area` rule and add `position: relative;`.

**Part C: Add JS logic to side_panel.js**

- [ ] **Step 3: Add command state variables and DOM refs at top of side_panel.js**

After the existing variable declarations (around line 33), add:

```js
// 快捷指令
let quickCommands = [];
const commandPopup = document.getElementById('commandPopup');
let commandPopupOpen = false;
let commandSelectedIndex = 0;
```

- [ ] **Step 4: Add command loading and storage change listener**

After the existing `chrome.storage.sync.get(['systemPrompt']...` block (around line 74), add:

```js
// 加载快捷指令
function loadQuickCommands() {
  chrome.storage.local.get(['quickCommands'], (data) => {
    quickCommands = data.quickCommands || [];
  });
}
loadQuickCommands();

// 监听快捷指令变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.quickCommands) {
    quickCommands = changes.quickCommands.newValue || [];
    // 如果弹出列表正在显示，更新筛选
    if (commandPopupOpen) {
      updateCommandPopup(userInput.value);
    }
  }
});
```

- [ ] **Step 5: Replace the existing userInput `input` event listener with command-aware version**

Find the existing input handler (around line 145-148):

```js
// 输入框自动调整高度
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
});
```

Replace with:

```js
// 输入框自动调整高度 + 快捷指令检测
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';

  const value = userInput.value;
  if (value.startsWith('/')) {
    updateCommandPopup(value);
  } else if (commandPopupOpen) {
    hideCommandPopup();
  }
});
```

- [ ] **Step 6: Update the existing keydown handler to handle command popup interactions**

Find the existing keydown handler (around line 137-142):

```js
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
```

Replace with:

```js
userInput.addEventListener('keydown', (e) => {
  if (commandPopupOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        commandSelectedIndex = (commandSelectedIndex + 1) % filtered.length;
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        commandSelectedIndex = (commandSelectedIndex - 1 + filtered.length) % filtered.length;
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        executeQuickCommand(filtered[commandSelectedIndex]);
      } else {
        hideCommandPopup();
        sendMessage();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideCommandPopup();
      return;
    }
  } else {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
});
```

- [ ] **Step 7: Add popup helper functions**

Add after the keydown handler:

```js
// 获取筛选后的指令列表
function getFilteredCommands(input) {
  const query = input.slice(1).toLowerCase(); // 去掉开头的 /
  if (!query) return quickCommands;
  return quickCommands.filter(cmd => cmd.name.toLowerCase().includes(query));
}

// 更新弹出列表
function updateCommandPopup(input) {
  const filtered = getFilteredCommands(input);
  if (filtered.length === 0 && quickCommands.length === 0) {
    hideCommandPopup();
    return;
  }
  commandSelectedIndex = 0;
  commandPopupOpen = true;
  renderCommandPopup(filtered);
}

// 渲染弹出列表
function renderCommandPopup(filtered) {
  commandPopup.classList.remove('hidden');

  if (filtered.length === 0) {
    commandPopup.innerHTML = '<div class="command-popup-empty">无匹配的快捷指令</div>';
    return;
  }

  commandPopup.innerHTML = filtered.map((cmd, idx) => {
    const preview = cmd.prompt.length > 30 ? cmd.prompt.slice(0, 30) + '...' : cmd.prompt;
    return `<div class="command-popup-item${idx === commandSelectedIndex ? ' selected' : ''}" data-idx="${idx}">
      <span class="command-popup-item-name">/${escapeHtml(cmd.name)}</span>
      <span class="command-popup-item-preview">${escapeHtml(preview)}</span>
    </div>`;
  }).join('');
}

// 隐藏弹出列表
function hideCommandPopup() {
  commandPopupOpen = false;
  commandSelectedIndex = 0;
  commandPopup.classList.add('hidden');
}

// 点击指令项
commandPopup.addEventListener('click', (e) => {
  const item = e.target.closest('.command-popup-item');
  if (!item) return;
  const idx = parseInt(item.dataset.idx);
  const filtered = getFilteredCommands(userInput.value);
  if (filtered[idx]) {
    executeQuickCommand(filtered[idx]);
  }
});

// 点击外部关闭
document.addEventListener('click', (e) => {
  if (commandPopupOpen && !commandPopup.contains(e.target) && e.target !== userInput) {
    hideCommandPopup();
  }
});
```

- [ ] **Step 8: Add executeQuickCommand function**

This mirrors `handleQuickAction` but uses user-defined prompt:

```js
// 执行快捷指令
async function executeQuickCommand(cmd) {
  if (isGenerating) return;

  hideCommandPopup();
  userInput.value = '';

  try {
    appendMessage('user', `/${cmd.name}（正在读取页面...）`);

    const data = await extractPageContent();
    if (!data.textContent.trim()) {
      removeLastMessage();
      appendMessage('error', '当前页面没有可读取的内容');
      return;
    }

    const truncated = safeTruncate(data.textContent, TRUNCATE_LIMITS.QUICK_ACTION);
    const prompt = `${cmd.prompt}\n\n网页标题：${pageTitle}\n\n网页内容如下：\n${truncated}`;

    conversationHistory = [];
    if (customSystemPrompt) {
      conversationHistory.push({ role: 'system', content: customSystemPrompt });
    }
    conversationHistory.push({ role: 'user', content: prompt });

    updateLastMessage('user', `/${cmd.name}`);
    await callAI(conversationHistory);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
  }
}
```

- [ ] **Step 9: Test the full flow in browser**

1. Reload extension
2. Open settings → add a command like name: `总结`, prompt: `请用中文总结以下网页内容。要求：用 3-5 个要点概括核心内容`
3. Open any webpage → click extension → type `/` in input → popup appears
4. Type `/总` → filters to "总结"
5. Press Enter → executes command, shows AI response
6. Test keyboard nav (↑/↓), Esc to close, click outside to close

- [ ] **Step 10: Commit**

```bash
git add side_panel/side_panel.html side_panel/side_panel.css side_panel/side_panel.js
git commit -m "feat: add quick command popup and execution in chat input"
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md with quick commands info**

Add to the "Communication patterns" section, after "Chat history":

```markdown
- **Quick commands**: `chrome.storage.local` for `quickCommands` (array of `{ name, prompt }`). Managed in settings page with real-time save. Side panel loads on init and listens to `chrome.storage.onChanged`. Triggered by typing `/` in chat input
```

Add to the "State management in side_panel.js" section:

```markdown
- `quickCommands` — cached array of user-defined quick commands from storage
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with quick commands feature"
```
