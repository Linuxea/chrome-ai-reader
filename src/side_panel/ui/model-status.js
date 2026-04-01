// ui/model-status.js — 模型状态栏

import { t } from '../../shared/i18n.js';

let _modelStatusBar;

export function initModelStatus() {
  _modelStatusBar = document.getElementById('modelStatusBar');

  chrome.storage.sync.get(['modelName'], (data) => {
    updateModelStatusBar(data.modelName);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.modelName) {
      updateModelStatusBar(changes.modelName.newValue);
    }
  });
}

export function updateModelStatusBar(name) {
  _modelStatusBar.textContent = t('sidebar.modelStatus') + (name || 'deepseek-chat');
}
