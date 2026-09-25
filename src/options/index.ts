import { t } from '../shared/i18n.js';
import { showStatus } from './status';
import { SYNC_FIELDS } from './fields';
import { readStoredSettings, writeSettings, removeSettings, type SettingKey } from '../platform/settings';
import { initThemeSettings } from './theme-settings';
import { initLlmSettings, fetchModels, loadLlmValues, collectLlmSaveData } from './llm-settings';
import { initTtsSettings, loadTtsValues, collectTtsSaveData } from './tts-settings';
import { initSuggestSettings, loadSuggestValues, collectSuggestSaveData } from './suggest-settings';
import { initEmbeddingSettings, loadEmbeddingValues, collectEmbeddingSaveData } from './embedding-settings';
import { initQuickCommandsEditor } from './quick-commands-editor';
import { initImportExport } from './import-export';

initThemeSettings();
initLlmSettings();
initTtsSettings();
initSuggestSettings();
initEmbeddingSettings();
initQuickCommandsEditor();
initImportExport();

readStoredSettings(SYNC_FIELDS as SettingKey[]).then((data) => {
  loadLlmValues(data as Record<string, unknown>);
  loadTtsValues(data as Record<string, unknown>);
  loadSuggestValues(data as Record<string, unknown>);
  loadEmbeddingValues(data as Record<string, unknown>);
  if (data.apiKey) fetchModels();
});

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;

saveBtn.addEventListener('click', () => {
  const llm = collectLlmSaveData();
  if (llm.error) { showStatus(llm.error, 'error'); return; }

  const tts = collectTtsSaveData();
  const suggest = collectSuggestSaveData();
  const embedding = collectEmbeddingSaveData();

  if (embedding.error) { showStatus(embedding.error, 'error'); return; }

  const toRemove = [...(llm.remove || []), ...(tts.remove || []), ...(embedding.remove || [])];
  const data = { ...(llm.set || {}), ...tts.set, ...suggest.set, ...embedding.set };

  Promise.all([removeSettings(toRemove), writeSettings(data)]).then(() => {
    showStatus(t('status.settingsSaved'), 'success');
    saveBtn.classList.add('saved');
    saveBtn.textContent = t('settings.saved');
    setTimeout(() => { saveBtn.classList.remove('saved'); saveBtn.textContent = t('settings.save'); }, 2000);
  });
});
