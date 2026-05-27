// quick-commands-editor.js — 快捷指令的 CRUD + 渲染 + 验证

import { t } from '../shared/i18n.js';
import { escapeHtml } from '../shared/constants.js';
import { showStatus } from './status.js';

export const COMMANDS_KEY = 'quickCommands';

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

export function saveQuickCommands(commands) {
  if (commands.length === 0) {
    chrome.storage.local.remove(COMMANDS_KEY);
  } else {
    chrome.storage.local.set({ [COMMANDS_KEY]: commands });
  }
}

export function renderCurrentCommands(commands) {
  renderQuickCommands(commands);
}

export function initQuickCommandsEditor() {
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
}
