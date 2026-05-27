// import-export.js — 设置的导入 / 导出

import { t } from '../shared/i18n.js';
import { downloadFile } from '../shared/download.js';
import { showStatus } from './status.js';
import { textFields, checkboxFields, SYNC_FIELDS } from './fields.js';
import { COMMANDS_KEY, saveQuickCommands, renderCurrentCommands } from './quick-commands-editor.js';
import { fetchModels } from './llm-settings.js';

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

export function initImportExport() {
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
        downloadFile(json, `ai-reader-settings-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
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

        // 清除导入文件中不存在的字段
        Object.keys(textFields).forEach(f => {
          if (!(f in data)) chrome.storage.sync.remove(f);
        });
        Object.keys(checkboxFields).forEach(f => {
          if (!(f in data)) {
            chrome.storage.sync.remove(f);
            checkboxFields[f].checked = checkboxFields[f].defaultChecked;
          }
        });

        chrome.storage.sync.set(syncData, () => {
          if (data.quickCommands && Array.isArray(data.quickCommands)) {
            saveQuickCommands(data.quickCommands);
            renderCurrentCommands(data.quickCommands);
          } else if ('quickCommands' in data) {
            saveQuickCommands([]);
            renderCurrentCommands([]);
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
}
