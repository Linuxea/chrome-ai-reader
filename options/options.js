// options.js — 设置页逻辑

// === 夜间模式 ===
const themeToggleBtn = document.getElementById('themeToggleBtn');

function applyTheme(dark, themeName) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  const moonIcon = themeToggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = themeToggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}

chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
  const themeName = data.themeName || 'sujian';
  applyTheme(!!data.darkMode, themeName);
  updateThemePicker(themeName);
});

themeToggleBtn.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newDark = !isDark;
  applyTheme(newDark);
  chrome.storage.sync.set({ darkMode: newDark });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.darkMode || changes.themeName) {
      const isDark = changes.darkMode ? !!changes.darkMode.newValue : document.documentElement.getAttribute('data-theme') === 'dark';
      const currentTheme = changes.themeName ? changes.themeName.newValue : document.documentElement.getAttribute('data-theme-name') || 'sujian';
      applyTheme(isDark, currentTheme);
      if (changes.themeName) updateThemePicker(changes.themeName.newValue);
    }
  }
});

// === 外观主题 ===
const themePicker = document.getElementById('themePicker');

function updateThemePicker(themeName) {
  themePicker.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === (themeName || 'sujian'));
  });
}

themePicker.addEventListener('click', (e) => {
  const card = e.target.closest('.theme-card');
  if (!card) return;
  const themeName = card.dataset.theme;
  chrome.storage.sync.set({ themeName });
  // applyTheme will be called by storage.onChanged listener
});

const apiKeyInput = document.getElementById('apiKey');
const apiBaseInput = document.getElementById('apiBase');
const modelNameInput = document.getElementById('modelName');
const systemPromptInput = document.getElementById('systemPrompt');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// TTS 配置
const ttsAppIdInput = document.getElementById('ttsAppId');
const ttsAccessKeyInput = document.getElementById('ttsAccessKey');
const ttsResourceIdInput = document.getElementById('ttsResourceId');
const ttsSpeakerInput = document.getElementById('ttsSpeaker');

// 推荐追问
const suggestQuestionsCheckbox = document.getElementById('suggestQuestions');

// TTS 自动播放
const ttsAutoPlayCheckbox = document.getElementById('ttsAutoPlay');

// 文本输入框字段：字段名 → input 元素
const textFields = {
  apiKey: apiKeyInput,
  apiBase: apiBaseInput,
  modelName: modelNameInput,
  systemPrompt: systemPromptInput,
  ttsAppId: ttsAppIdInput,
  ttsAccessKey: ttsAccessKeyInput,
  ttsResourceId: ttsResourceIdInput,
  ttsSpeaker: ttsSpeakerInput,
};

// checkbox 字段：字段名 → checkbox 元素
const checkboxFields = {
  suggestQuestions: suggestQuestionsCheckbox,
  ttsAutoPlay: ttsAutoPlayCheckbox,
};

// 所有 sync storage 字段名（用于 storage.get / export / import）
const SYNC_FIELDS = [...Object.keys(textFields), ...Object.keys(checkboxFields), 'themeName'];

// 加载已保存的设置
chrome.storage.sync.get(SYNC_FIELDS, (data) => {
  // 文本输入框
  for (const [key, input] of Object.entries(textFields)) {
    if (data[key]) input.value = data[key];
  }
  // checkbox
  for (const [key, checkbox] of Object.entries(checkboxFields)) {
    if (data[key] !== undefined) checkbox.checked = data[key];
  }
  // 有 apiKey 时自动获取模型列表
  if (data.apiKey) {
    fetchModels();
  }
});

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

    const modelList = document.getElementById('model-list');
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
    showStatus('获取模型列表失败：' + e.message, 'error');
  } finally {
    refreshModelsBtn.disabled = false;
    refreshModelsBtn.textContent = '刷新模型列表';
  }
}

refreshModelsBtn.addEventListener('click', fetchModels);

// 推荐追问开关 — 实时保存
suggestQuestionsCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({ suggestQuestions: suggestQuestionsCheckbox.checked });
});

// TTS 自动播放开关 — 实时保存
ttsAutoPlayCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({ ttsAutoPlay: ttsAutoPlayCheckbox.checked });
});

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

  // TTS 配置
  const ttsAppId = ttsAppIdInput.value.trim();
  const ttsAccessKey = ttsAccessKeyInput.value.trim();
  const ttsResourceId = ttsResourceIdInput.value.trim();
  const ttsSpeaker = ttsSpeakerInput.value.trim();

  if (ttsAppId) { data.ttsAppId = ttsAppId; } else { chrome.storage.sync.remove('ttsAppId'); }
  if (ttsAccessKey) { data.ttsAccessKey = ttsAccessKey; } else { chrome.storage.sync.remove('ttsAccessKey'); }
  if (ttsResourceId) { data.ttsResourceId = ttsResourceId; } else { chrome.storage.sync.remove('ttsResourceId'); }
  if (ttsSpeaker) { data.ttsSpeaker = ttsSpeaker; } else { chrome.storage.sync.remove('ttsSpeaker'); }

  // 推荐追问
  data.suggestQuestions = suggestQuestionsCheckbox.checked;

  // TTS 自动播放
  data.ttsAutoPlay = ttsAutoPlayCheckbox.checked;

  chrome.storage.sync.set(data, () => {
    showStatus('设置已保存', 'success');
  });
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 3000);
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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

// === 设置导入导出 ===

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

// 导出设置
exportBtn.addEventListener('click', () => {
  chrome.storage.sync.get(SYNC_FIELDS, (syncData) => {
    chrome.storage.local.get([COMMANDS_KEY], (localData) => {
      const exportData = { version: 1 };

      // 导出所有有值的 sync 字段
      for (const key of SYNC_FIELDS) {
        if (key in checkboxFields) {
          // boolean 字段，false 也是有效值
          if (syncData[key] !== undefined) exportData[key] = syncData[key];
        } else if (syncData[key]) {
          exportData[key] = syncData[key];
        }
      }

      const commands = localData[COMMANDS_KEY];
      if (commands && commands.length > 0) exportData.quickCommands = commands;

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-reader-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('设置已导出', 'success');
    });
  });
});

// 导入设置
importBtn.addEventListener('click', () => {
  importFile.click();
});

importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);

      if (!data.version || typeof data !== 'object') {
        showStatus('无效的设置文件格式', 'error');
        return;
      }

      // 写入 sync storage，回填输入框
      const syncData = {};
      // 文本输入框
      for (const [key, input] of Object.entries(textFields)) {
        if (data[key]) {
          syncData[key] = data[key];
          input.value = data[key];
        }
      }
      // checkbox
      for (const [key, checkbox] of Object.entries(checkboxFields)) {
        if (data[key] !== undefined) {
          syncData[key] = data[key];
          checkbox.checked = data[key];
        }
      }

      // 清除未导入的文本字段（checkbox 保留当前值）
      Object.keys(textFields).forEach(f => {
        if (!(f in data)) chrome.storage.sync.remove(f);
      });

      chrome.storage.sync.set(syncData, () => {
        // 写入 quickCommands 到 local storage
        if (data.quickCommands && Array.isArray(data.quickCommands)) {
          saveQuickCommands(data.quickCommands);
          renderQuickCommands(data.quickCommands);
        }

        // 如果有 apiKey 则刷新模型列表
        if (syncData.apiKey) fetchModels();

        showStatus('设置已导入并保存', 'success');
      });
    } catch (err) {
      showStatus('解析文件失败：' + err.message, 'error');
    }
  };
  reader.readAsText(file);

  // 重置 input，允许重复选择同一文件
  importFile.value = '';
});
