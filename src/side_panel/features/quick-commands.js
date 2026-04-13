// features/quick-commands.js — 快捷指令弹出列表管理

import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';

let _userInput;
let _commandPopup;
let _sendToAI;

let commandPopupOpen = false;
let commandSelectedIndex = 0;

export function initQuickCommands({ userInput, commandPopup, onSendToAI }) {
  _userInput = userInput;
  _commandPopup = commandPopup;
  _sendToAI = onSendToAI;

  // 加载快捷指令
  chrome.storage.local.get(['quickCommands'], (data) => {
    state.setQuickCommands(data.quickCommands || []);
  });

  // 监听快捷指令变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.quickCommands) {
      state.setQuickCommands(changes.quickCommands.newValue || []);
      if (commandPopupOpen) {
        updateCommandPopup(_userInput.value);
      }
    }
  });

  // 点击指令项
  _commandPopup.addEventListener('click', (e) => {
    const item = e.target.closest('.command-popup-item');
    if (!item) return;
    const idx = parseInt(item.dataset.idx);
    const filtered = getFilteredCommands(_userInput.value);
    if (filtered[idx]) {
      executeQuickCommand(filtered[idx]);
    }
  });

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (commandPopupOpen && !_commandPopup.contains(e.target) && e.target !== _userInput) {
      hideCommandPopup();
    }
  });
}

export function isCommandPopupOpen() {
  return commandPopupOpen;
}

export function getCommandSelectedIndex() {
  return commandSelectedIndex;
}

export function setCommandSelectedIndex(v) {
  commandSelectedIndex = v;
}

export function getFilteredCommands(input) {
  const query = input.slice(1).toLowerCase();
  const quickCommands = state.getQuickCommands();
  if (!query) return quickCommands;
  return quickCommands.filter(cmd => cmd.name.toLowerCase().includes(query));
}

export function updateCommandPopup(input) {
  const filtered = getFilteredCommands(input);
  const quickCommands = state.getQuickCommands();
  if (filtered.length === 0 && quickCommands.length === 0) {
    hideCommandPopup();
    return;
  }
  commandSelectedIndex = 0;
  commandPopupOpen = true;
  renderCommandPopup(filtered);
}

export function renderCommandPopup(filtered) {
  _commandPopup.classList.remove('hidden');

  if (filtered.length === 0) {
    _commandPopup.innerHTML = `<div class="command-popup-empty">${t('cmd.noMatch')}</div>`;
    return;
  }

  _commandPopup.innerHTML = filtered.map((cmd, idx) => {
    const preview = cmd.prompt.length > 30 ? cmd.prompt.slice(0, 30) + '...' : cmd.prompt;
    return `<div class="command-popup-item${idx === commandSelectedIndex ? ' selected' : ''}" data-idx="${idx}">
      <span class="command-popup-item-name">/${escapeHtml(cmd.name)}</span>
      <span class="command-popup-item-preview">${escapeHtml(preview)}</span>
    </div>`;
  }).join('');
}

export function hideCommandPopup() {
  commandPopupOpen = false;
  commandSelectedIndex = 0;
  _commandPopup.classList.add('hidden');
}

export function executeQuickCommand(cmd) {
  if (state.getIsGenerating()) return;

  hideCommandPopup();
  _userInput.value = '';
  _sendToAI(cmd.prompt, `/${cmd.name}`);
}
