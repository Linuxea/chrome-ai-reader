import { t } from '../shared/i18n.js';
import { showStatus } from './status';
import { DEFAULT_API_BASE, DEFAULT_ANTHROPIC_API_BASE } from '../platform/settings';

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const apiBaseInput = document.getElementById('apiBase') as HTMLInputElement;
const modelNameInput = document.getElementById('modelName') as HTMLInputElement;
const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
const refreshModelsBtn = document.getElementById('refreshModelsBtn') as HTMLButtonElement;
const providerSelect = document.getElementById('provider') as HTMLSelectElement | null;
const fastModelInput = document.getElementById('fastModelName') as HTMLInputElement | null;
const citationsBox = document.getElementById('citations') as HTMLInputElement | null;
const agentModeBox = document.getElementById('agentMode') as HTMLInputElement | null;

const currentProvider = (): 'openai' | 'anthropic' => (providerSelect?.value === 'anthropic' ? 'anthropic' : 'openai');
const defaultBase = (): string => (currentProvider() === 'anthropic' ? DEFAULT_ANTHROPIC_API_BASE : DEFAULT_API_BASE);

/** Placeholders follow the provider so an empty field shows what will be used. */
function syncProviderHints(): void {
  apiBaseInput.placeholder = defaultBase();
  apiKeyInput.placeholder = currentProvider() === 'anthropic' ? 'sk-ant-...' : 'sk-...';
}

export async function fetchModels(): Promise<void> {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || defaultBase();
  if (!apiKey) { showStatus(t('error.noApiKeySave'), 'error'); return; }

  refreshModelsBtn.disabled = true; refreshModelsBtn.textContent = t('status.loading');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'fetchModels', apiBase, apiKey, provider: currentProvider() }) as { success: boolean; models?: string[]; error?: string };
    const modelList = document.getElementById('model-list') as HTMLElement;
    modelList.innerHTML = '';
    if (response.success && response.models) { response.models.forEach(id => { const option = document.createElement('option'); option.value = id; modelList.appendChild(option); }); showStatus(t('status.modelsLoaded', { n: response.models!.length }), 'success'); }
    else showStatus(response.error || t('error.fetchModelsFailed'), 'error');
  } catch (e: unknown) { showStatus(t('error.fetchModelsFailed') + '：' + (e as Error).message, 'error'); }
  finally { refreshModelsBtn.disabled = false; refreshModelsBtn.textContent = t('settings.llm.refreshModels'); }
}

export function initLlmSettings(): void {
  refreshModelsBtn.addEventListener('click', fetchModels);
  providerSelect?.addEventListener('change', syncProviderHints);
  syncProviderHints();
}

export function loadLlmValues(data: Record<string, unknown>): void {
  if (data.apiKey) apiKeyInput.value = data.apiKey as string;
  if (data.apiBase) apiBaseInput.value = data.apiBase as string;
  if (data.modelName) modelNameInput.value = data.modelName as string;
  if (data.systemPrompt) systemPromptInput.value = data.systemPrompt as string;
  if (providerSelect && data.provider) providerSelect.value = data.provider as string;
  if (fastModelInput && data.fastModelName) fastModelInput.value = data.fastModelName as string;
  if (citationsBox && data.citations !== undefined) citationsBox.checked = data.citations as boolean;
  if (agentModeBox && data.agentMode !== undefined) agentModeBox.checked = data.agentMode as boolean;
  syncProviderHints();
}

export function collectLlmSaveData(): { error?: string; set?: Record<string, string | boolean>; remove?: string[] } {
  const apiKey = apiKeyInput.value.trim(); const apiBase = apiBaseInput.value.trim(); const modelName = modelNameInput.value.trim(); const systemPrompt = systemPromptInput.value.trim();
  if (!apiKey) return { error: t('error.noApiKeySave') };
  if (!apiKey.startsWith('sk-') && !apiBase) return { error: t('error.apiKeyHint') };
  // visionEnabled / ocrApiKey: retired settings (the chat model is assumed
  // multimodal, GLM-OCR was removed) — cleared from sync storage on save.
  const set: Record<string, string | boolean> = { apiKey }; const remove: string[] = ['visionEnabled', 'ocrApiKey'];
  if (apiBase) set.apiBase = apiBase; else remove.push('apiBase');
  if (modelName) set.modelName = modelName; else remove.push('modelName');
  if (systemPrompt) set.systemPrompt = systemPrompt; else remove.push('systemPrompt');
  set.provider = currentProvider();
  const fastModel = fastModelInput?.value.trim() ?? '';
  if (fastModel) set.fastModelName = fastModel; else remove.push('fastModelName');
  if (citationsBox) set.citations = citationsBox.checked;
  if (agentModeBox) set.agentMode = agentModeBox.checked;
  return { set, remove };
}
