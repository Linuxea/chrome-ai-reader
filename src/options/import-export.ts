import { t } from '../shared/i18n.js';
import { downloadFile } from '../shared/download';
import { showStatus } from './status';
import { textFields, checkboxFields, SYNC_FIELDS } from './fields';
import { COMMANDS_KEY, saveQuickCommands, renderCurrentCommands } from './quick-commands-editor';
import { fetchModels } from './llm-settings';

const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;

export function initImportExport(): void {
  exportBtn.addEventListener('click', () => {
    chrome.storage.sync.get(SYNC_FIELDS, (syncData) => {
      chrome.storage.local.get([COMMANDS_KEY], (localData) => {
        const exportData: Record<string, unknown> = { version: 1 };
        for (const key of SYNC_FIELDS) {
          if (key in checkboxFields) { if (syncData[key] !== undefined) exportData[key] = syncData[key]; }
          else if (syncData[key]) exportData[key] = syncData[key];
        }
        const commands = localData[COMMANDS_KEY] as { name: string; prompt: string }[] | undefined;
        if (commands?.length) exportData.quickCommands = commands;
        downloadFile(JSON.stringify(exportData, null, 2), `ai-reader-settings-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
        showStatus(t('status.exported'), 'success');
      });
    });
  });

  importBtn.addEventListener('click', () => { importFile.click(); });

  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target?.result as string) as Record<string, unknown>;
        if (!data.version || typeof data !== 'object') { showStatus(t('status.invalidFile'), 'error'); return; }
        const syncData: Record<string, unknown> = {};
        for (const [key, input] of Object.entries(textFields)) { if (data[key]) { syncData[key] = data[key]; input.value = data[key] as string; } }
        for (const [key, checkbox] of Object.entries(checkboxFields)) { if (data[key] !== undefined) { syncData[key] = data[key]; checkbox.checked = data[key] as boolean; } }
        Object.keys(textFields).forEach(f => { if (!(f in data)) chrome.storage.sync.remove(f); });
        Object.keys(checkboxFields).forEach(f => { if (!(f in data)) { chrome.storage.sync.remove(f); checkboxFields[f].checked = checkboxFields[f].defaultChecked; } });
        chrome.storage.sync.set(syncData, () => {
          if (data.quickCommands && Array.isArray(data.quickCommands)) { saveQuickCommands(data.quickCommands as { name: string; prompt: string }[]); renderCurrentCommands(data.quickCommands as { name: string; prompt: string }[]); }
          else if ('quickCommands' in data) { saveQuickCommands([]); renderCurrentCommands([]); }
          if (syncData.apiKey) fetchModels();
          showStatus(t('status.imported'), 'success');
        });
      } catch (err: unknown) { showStatus(t('status.parseError') + (err as Error).message, 'error'); }
    };
    reader.readAsText(file);
    importFile.value = '';
  });
}
