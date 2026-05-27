// index.js — 设置页入口，编排各 section 初始化

import { t } from '../shared/i18n.js';
import { showStatus } from './status.js';
import { SYNC_FIELDS } from './fields.js';
import { initThemeSettings } from './theme-settings.js';
import { initLlmSettings, fetchModels, loadLlmValues, collectLlmSaveData } from './llm-settings.js';
import { initTtsSettings, loadTtsValues, collectTtsSaveData } from './tts-settings.js';
import { initOcrSettings, loadOcrValues, collectOcrSaveData } from './ocr-settings.js';
import { initSuggestSettings, loadSuggestValues, collectSuggestSaveData } from './suggest-settings.js';
import { initQuickCommandsEditor } from './quick-commands-editor.js';
import { initImportExport } from './import-export.js';

// 初始化各 section
initThemeSettings();
initLlmSettings();
initTtsSettings();
initOcrSettings();
initSuggestSettings();
initQuickCommandsEditor();
initImportExport();

// 从 storage 加载所有字段的值
chrome.storage.sync.get(SYNC_FIELDS, (data) => {
  loadLlmValues(data);
  loadTtsValues(data);
  loadOcrValues(data);
  loadSuggestValues(data);
  // 有 apiKey 时自动拉取模型列表
  if (data.apiKey) {
    fetchModels();
  }
});

// 保存按钮 — 聚合各 section 的数据统一写入
const saveBtn = document.getElementById('saveBtn');

saveBtn.addEventListener('click', () => {
  const llm = collectLlmSaveData();
  if (llm.error) { showStatus(llm.error, 'error'); return; }

  const tts = collectTtsSaveData();
  const ocr = collectOcrSaveData();
  const suggest = collectSuggestSaveData();

  // 先清除各 section 要求移除的字段
  const toRemove = [...(llm.remove || []), ...(tts.remove || []), ...(ocr.remove || [])];
  if (toRemove.length > 0) chrome.storage.sync.remove(toRemove);

  // 合并所有 section 要写入的数据
  const data = { ...llm.set, ...tts.set, ...ocr.set, ...suggest.set };

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
