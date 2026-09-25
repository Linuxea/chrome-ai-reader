import { t } from '../shared/i18n.js';
import { downloadFile } from '../shared/download';
import { showStatus } from './status';
import { textFields, checkboxFields, SYNC_FIELDS } from './fields';
import { readStoredSettings, writeSettings, removeSettings, isSecret, type SettingKey, type Settings } from '../platform/settings';
import { COMMANDS_KEY, saveQuickCommands, renderCurrentCommands } from './quick-commands-editor';
import { fetchModels } from './llm-settings';

const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const includeSecretsBox = document.getElementById('exportIncludeSecrets') as HTMLInputElement | null;

export function initImportExport(): void {
  exportBtn.addEventListener('click', async () => {
    const [stored, localData] = await Promise.all([
      readStoredSettings(SYNC_FIELDS as SettingKey[]),
      chrome.storage.local.get([COMMANDS_KEY]),
    ]);
    const values = stored as Record<string, unknown>;
    const exportData: Record<string, unknown> = { version: 1 };
    const includeSecrets = includeSecretsBox?.checked === true;
    for (const key of SYNC_FIELDS) {
      if (!includeSecrets && isSecret(key)) continue;
      if (key in checkboxFields) { if (values[key] !== undefined) exportData[key] = values[key]; }
      else if (values[key]) exportData[key] = values[key];
    }
    const commands = localData[COMMANDS_KEY] as { name: string; prompt: string }[] | undefined;
    if (commands?.length) exportData.quickCommands = commands;
    downloadFile(JSON.stringify(exportData, null, 2), `ai-reader-settings-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    showStatus(t('status.exported'), 'success');
  });

  importBtn.addEventListener('click', () => { importFile.click(); });

  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = JSON.parse(evt.target?.result as string) as Record<string, unknown>;
        if (!data.version || typeof data !== 'object') { showStatus(t('status.invalidFile'), 'error'); return; }
        const values: Record<string, unknown> = {};
        for (const [key, input] of Object.entries(textFields)) { if (data[key]) { values[key] = data[key]; input.value = data[key] as string; } }
        for (const [key, checkbox] of Object.entries(checkboxFields)) { if (data[key] !== undefined) { values[key] = data[key]; checkbox.checked = data[key] as boolean; } }
        // A backup exported without secrets must not wipe the configured keys.
        const toRemove = Object.keys(textFields).filter(f => !(f in data) && !isSecret(f));
        for (const f of Object.keys(checkboxFields)) {
          if (!(f in data)) { toRemove.push(f); checkboxFields[f].checked = checkboxFields[f].defaultChecked; }
        }
        await Promise.all([removeSettings(toRemove), writeSettings(values as Partial<Settings>)]);
        if (data.quickCommands && Array.isArray(data.quickCommands)) { saveQuickCommands(data.quickCommands as { name: string; prompt: string }[]); renderCurrentCommands(data.quickCommands as { name: string; prompt: string }[]); }
        else if ('quickCommands' in data) { saveQuickCommands([]); renderCurrentCommands([]); }
        if (values.apiKey) fetchModels();
        showStatus(t('status.imported'), 'success');
      } catch (err: unknown) { showStatus(t('status.parseError') + (err as Error).message, 'error'); }
    };
    reader.readAsText(file);
    importFile.value = '';
  });
}
