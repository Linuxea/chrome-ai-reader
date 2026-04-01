// options.js -- 设置页逻辑

import { t, loadLanguage, setLanguage, applyTranslations, getCurrentLang } from '../shared/i18n.js';
import { escapeHtml } from '../shared/constants.js';

// === 语言 ===
const languageSelect = document.getElementById('languageSelect');

loadLanguage((lang) => {
  languageSelect.value = lang;
});

languageSelect.addEventListener('change', () => {
  const lang = languageSelect.value;
  setLanguage(lang);
  chrome.storage.sync.set({ language: lang });
});

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
  const currentTheme = document.documentElement.getAttribute('data-theme-name') || 'sujian';
  applyTheme(newDark, currentTheme);
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
});

const apiKeyInput = document.getElementById('apiKey');
const apiBaseInput = document.getElementById('apiBase');
const modelNameInput = document.getElementById('modelName');
const systemPromptInput = document.getElementById('systemPrompt');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

const ttsAppIdInput = document.getElementById('ttsAppId');
const ttsAccessKeyInput = document.getElementById('ttsAccessKey');
const ttsResourceIdInput = document.getElementById('ttsResourceId');
const ttsSpeakerInput = document.getElementById('ttsSpeaker');

const ocrApiKeyInput = document.getElementById('ocrApiKey');

const suggestQuestionsCheckbox = document.getElementById('suggestQuestions');

const ttsAutoPlayCheckbox = document.getElementById('ttsAutoPlay');

const textFields = {
  apiKey: apiKeyInput,
  apiBase: apiBaseInput,
  modelName: modelNameInput,
  systemPrompt: systemPromptInput,
  ttsAppId: ttsAppIdInput,
  ttsAccessKey: ttsAccessKeyInput,
  ttsResourceId: ttsResourceIdInput,
  ttsSpeaker: ttsSpeakerInput,
  ocrApiKey: ocrApiKeyInput,
};

const checkboxFields = {
  suggestQuestions: suggestQuestionsCheckbox,
  ttsAutoPlay: ttsAutoPlayCheckbox,
};

const SYNC_FIELDS = [...Object.keys(textFields), ...Object.keys(checkboxFields), 'themeName', 'language'];

chrome.storage.sync.get(SYNC_FIELDS, (data) => {
  for (const [key, input] of Object.entries(textFields)) {
    if (data[key]) input.value = data[key];
  }
  for (const [key, checkbox] of Object.entries(checkboxFields)) {
    if (data[key] !== undefined) checkbox.checked = data[key];
  }
  if (data.apiKey) {
    fetchModels();
  }
});

async function fetchModels() {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || 'https://api.deepseek.com';

  if (!apiKey) {
    showStatus(t('error.noApiKeySave'), 'error');
    return;
  }

  refreshModelsBtn.disabled = true;
  refreshModelsBtn.textContent = t('status.loading');

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
      showStatus(t('status.modelsLoaded', { n: response.models.length }), 'success');
    } else {
      showStatus(response.error || t('error.fetchModelsFailed'), 'error');
    }
  } catch (e) {
    showStatus(t('error.fetchModelsFailed') + '：' + e.message, 'error');
  } finally {
    refreshModelsBtn.disabled = false;
    refreshModelsBtn.textContent = t('settings.llm.refreshModels');
  }
}

refreshModelsBtn.addEventListener('click', fetchModels);

suggestQuestionsCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({ suggestQuestions: suggestQuestionsCheckbox.checked });
});

ttsAutoPlayCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({ ttsAutoPlay: ttsAutoPlayCheckbox.checked });
});

saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim();
  const modelName = modelNameInput.value.trim();
  const systemPrompt = systemPromptInput.value.trim();

  if (!apiKey) {
    showStatus(t('error.noApiKeySave'), 'error');
    return;
  }

  if (!apiKey.startsWith('sk-') && !apiBase) {
    showStatus(t('error.apiKeyHint'), 'error');
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

  const ttsAppId = ttsAppIdInput.value.trim();
  const ttsAccessKey = ttsAccessKeyInput.value.trim();
  const ttsResourceId = ttsResourceIdInput.value.trim();
  const ttsSpeaker = ttsSpeakerInput.value.trim();

  if (ttsAppId) { data.ttsAppId = ttsAppId; } else { chrome.storage.sync.remove('ttsAppId'); }
  if (ttsAccessKey) { data.ttsAccessKey = ttsAccessKey; } else { chrome.storage.sync.remove('ttsAccessKey'); }
  if (ttsResourceId) { data.ttsResourceId = ttsResourceId; } else { chrome.storage.sync.remove('ttsResourceId'); }
  if (ttsSpeaker) { data.ttsSpeaker = ttsSpeaker; } else { chrome.storage.sync.remove('ttsSpeaker'); }

  const ocrApiKey = ocrApiKeyInput.value.trim();
  if (ocrApiKey) { data.ocrApiKey = ocrApiKey; } else { chrome.storage.sync.remove('ocrApiKey'); }

  data.suggestQuestions = suggestQuestionsCheckbox.checked;

  data.ttsAutoPlay = ttsAutoPlayCheckbox.checked;

  chrome.storage.sync.set(data, () => {
    showStatus(t('status.settingsSaved'), 'success');
    saveBtn.classList.add('saved');
    saveBtn.textContent = t('settings.saved');
    setTimeout(() => {
      saveBtn.classList.remove('saved');
      saveBtn.textContent = t('settings.save');
    }, 2000);
  });
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  requestAnimationFrame(() => {
    statusEl.classList.add('show');
  });
  clearTimeout(showStatus._timer);
  showStatus._timer = setTimeout(() => {
    statusEl.classList.remove('show');
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, 300);
  }, 3000);
}

// === 快捷指令管理 ===

const COMMANDS_KEY = 'quickCommands';
const quickCommandsList = document.getElementById('quickCommandsList');
const addCommandBtn = document.getElementById('addCommandBtn');
let editingIndex = -1;

function loadQuickCommands() {
  chrome.storage.local.get([COMMANDS_KEY], (data) => {
    const commands = data[COMMANDS_KEY] || [];
    renderQuickCommands(commands);
  });
}

function renderQuickCommands(commands) {
  quickCommandsList.innerHTML = '';

  if (commands.length === 0 && editingIndex !== -2) {
    quickCommandsList.innerHTML = `<div class="quick-commands-empty">${t('settings.commands.empty')}</div>`;
    return;
  }

  commands.forEach((cmd, idx) => {
    if (editingIndex === idx) {
      quickCommandsList.appendChild(createEditForm(cmd.name, cmd.prompt, idx));
    } else {
      const item = document.createElement('div');
      item.className = 'quick-command-item';
      const preview = cmd.prompt.length > 50 ? cmd.prompt.slice(0, 50) + '...' : cmd.prompt;
      item.innerHTML = `
        <div class="quick-command-info">
          <div class="quick-command-name">/${escapeHtml(cmd.name)}</div>
          <div class="quick-command-preview">${escapeHtml(preview)}</div>
        </div>
        <button class="quick-command-btn edit-btn" data-idx="${idx}" title="${t('settings.commands.edit')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="quick-command-btn delete" data-idx="${idx}" title="${t('settings.commands.delete')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
          </svg>
        </button>
      `;
      quickCommandsList.appendChild(item);
    }
  });

  if (editingIndex === -2) {
    quickCommandsList.appendChild(createEditForm('', '', -2));
  }
}

function createEditForm(name, prompt, idx) {
  const form = document.createElement('div');
  form.className = 'quick-command-item';
  form.style.flexDirection = 'column';
  form.style.alignItems = 'stretch';
  form.innerHTML = `
    <div class="quick-command-edit-form">
      <input type="text" class="edit-name" value="${escapeHtml(name)}" placeholder="${t('settings.commands.name.ph')}">
      <textarea class="edit-prompt" rows="3" placeholder="${t('settings.commands.prompt.ph')}">${escapeHtml(prompt)}</textarea>
      <div class="quick-command-edit-actions">
        <button class="cancel-edit-btn" type="button">${t('settings.commands.cancel')}</button>
        <button class="save-edit-btn" type="button">${t('settings.commands.save')}</button>
      </div>
    </div>
  `;

  const nameInput = form.querySelector('.edit-name');
  const promptInput = form.querySelector('.edit-prompt');

  form.querySelector('.save-edit-btn').addEventListener('click', () => {
    const newName = nameInput.value.trim();
    const newPrompt = promptInput.value.trim();

    if (!newName || !newPrompt) {
      showStatus(t('status.commandEmpty'), 'error');
      return;
    }
    if (/[\s/]/.test(newName)) {
      showStatus(t('status.commandInvalid'), 'error');
      return;
    }

    chrome.storage.local.get([COMMANDS_KEY], (data) => {
      const commands = data[COMMANDS_KEY] || [];
      const duplicate = commands.findIndex((c, i) => c.name === newName && i !== idx);
      if (duplicate !== -1) {
        showStatus(t('status.commandDuplicate'), 'error');
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
      showStatus(t('status.commandSaved'), 'success');
    });
  });

  form.querySelector('.cancel-edit-btn').addEventListener('click', () => {
    editingIndex = -1;
    chrome.storage.local.get([COMMANDS_KEY], (data) => {
      renderQuickCommands(data[COMMANDS_KEY] || []);
    });
  });

  setTimeout(() => nameInput.focus(), 0);

  return form;
}

function saveQuickCommands(commands) {
  if (commands.length === 0) {
    chrome.storage.local.remove(COMMANDS_KEY);
  } else {
    chrome.storage.local.set({ [COMMANDS_KEY]: commands });
  }
}

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
      showStatus(t('status.commandDeleted'), 'success');
    });
  }
});

addCommandBtn.addEventListener('click', () => {
  editingIndex = -2;
  chrome.storage.local.get([COMMANDS_KEY], (data) => {
    renderQuickCommands(data[COMMANDS_KEY] || []);
  });
});

loadQuickCommands();

// === 设置导入导出 ===

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

exportBtn.addEventListener('click', () => {
  chrome.storage.sync.get(SYNC_FIELDS, (syncData) => {
    chrome.storage.local.get([COMMANDS_KEY], (localData) => {
      const exportData = { version: 1 };

      for (const key of SYNC_FIELDS) {
        if (key in checkboxFields) {
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
      showStatus(t('status.exported'), 'success');
    });
  });
});

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
        showStatus(t('status.invalidFile'), 'error');
        return;
      }

      const syncData = {};
      for (const [key, input] of Object.entries(textFields)) {
        if (data[key]) {
          syncData[key] = data[key];
          input.value = data[key];
        }
      }
      for (const [key, checkbox] of Object.entries(checkboxFields)) {
        if (data[key] !== undefined) {
          syncData[key] = data[key];
          checkbox.checked = data[key];
        }
      }

      Object.keys(textFields).forEach(f => {
        if (!(f in data)) chrome.storage.sync.remove(f);
      });

      chrome.storage.sync.set(syncData, () => {
        if (data.quickCommands && Array.isArray(data.quickCommands)) {
          saveQuickCommands(data.quickCommands);
          renderQuickCommands(data.quickCommands);
        }

        if (syncData.apiKey) fetchModels();

        showStatus(t('status.imported'), 'success');
      });
    } catch (err) {
      showStatus(t('status.parseError') + err.message, 'error');
    }
  };
  reader.readAsText(file);

  importFile.value = '';
});
