import { t } from '../shared/i18n.js';
import { showStatus } from './status';
import { SYNC_FIELDS } from './fields';
import { initThemeSettings } from './theme-settings';
import { initLlmSettings, fetchModels, loadLlmValues, collectLlmSaveData } from './llm-settings';
import { initTtsSettings, loadTtsValues, collectTtsSaveData } from './tts-settings';
import { initOcrSettings, loadOcrValues, collectOcrSaveData } from './ocr-settings';
import { initSuggestSettings, loadSuggestValues, collectSuggestSaveData } from './suggest-settings';
import { initQuickCommandsEditor } from './quick-commands-editor';
import { initImportExport } from './import-export';

initThemeSettings();
initLlmSettings();
initTtsSettings();
initOcrSettings();
initSuggestSettings();
initQuickCommandsEditor();
initImportExport();

chrome.storage.sync.get(SYNC_FIELDS, (data) => {
  loadLlmValues(data as Record<string, unknown>);
  loadTtsValues(data as Record<string, unknown>);
  loadOcrValues(data as Record<string, unknown>);
  loadSuggestValues(data as Record<string, unknown>);
  if (data.apiKey) fetchModels();
});

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;

saveBtn.addEventListener('click', () => {
  const llm = collectLlmSaveData();
  if (llm.error) { showStatus(llm.error, 'error'); return; }

  const tts = collectTtsSaveData();
  const ocr = collectOcrSaveData();
  const suggest = collectSuggestSaveData();

  const toRemove = [...(llm.remove || []), ...(tts.remove || []), ...(ocr.remove || [])];
  if (toRemove.length > 0) chrome.storage.sync.remove(toRemove);

  const data = { ...(llm.set || {}), ...tts.set, ...ocr.set, ...suggest.set };

  chrome.storage.sync.set(data, () => {
    showStatus(t('status.settingsSaved'), 'success');
    saveBtn.classList.add('saved');
    saveBtn.textContent = t('settings.saved');
    setTimeout(() => { saveBtn.classList.remove('saved'); saveBtn.textContent = t('settings.save'); }, 2000);
  });
});
