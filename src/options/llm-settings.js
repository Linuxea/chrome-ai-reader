// llm-settings.js — 大模型 API 配置（Key / Base / Model / System Prompt）+ fetchModels

import { t } from '../shared/i18n.js';
import { showStatus } from './status.js';

const apiKeyInput = document.getElementById('apiKey');
const apiBaseInput = document.getElementById('apiBase');
const modelNameInput = document.getElementById('modelName');
const systemPromptInput = document.getElementById('systemPrompt');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');

export async function fetchModels() {
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

export function initLlmSettings() {
  refreshModelsBtn.addEventListener('click', fetchModels);
}

export function loadLlmValues(data) {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.apiBase) apiBaseInput.value = data.apiBase;
  if (data.modelName) modelNameInput.value = data.modelName;
  if (data.systemPrompt) systemPromptInput.value = data.systemPrompt;
}

export function collectLlmSaveData() {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim();
  const modelName = modelNameInput.value.trim();
  const systemPrompt = systemPromptInput.value.trim();

  // 校验
  if (!apiKey) return { error: t('error.noApiKeySave') };
  if (!apiKey.startsWith('sk-') && !apiBase) return { error: t('error.apiKeyHint') };

  const set = { apiKey };
  const remove = [];

  if (apiBase) { set.apiBase = apiBase; } else { remove.push('apiBase'); }
  if (modelName) { set.modelName = modelName; } else { remove.push('modelName'); }
  if (systemPrompt) { set.systemPrompt = systemPrompt; } else { remove.push('systemPrompt'); }

  return { set, remove };
}
