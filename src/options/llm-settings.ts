import { t } from '../shared/i18n.js';
import { showStatus } from './status';

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const apiBaseInput = document.getElementById('apiBase') as HTMLInputElement;
const modelNameInput = document.getElementById('modelName') as HTMLInputElement;
const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
const refreshModelsBtn = document.getElementById('refreshModelsBtn') as HTMLButtonElement;
const visionEnabledInput = document.getElementById('visionEnabled') as HTMLInputElement;
const agentModeInput = document.getElementById('agentMode') as HTMLInputElement;
const agentToolsBox = document.getElementById('agentTools') as HTMLElement;
const toolInputs = {
  read_page: document.getElementById('toolReadPage') as HTMLInputElement,
  find_related_pages: document.getElementById('toolFindRelated') as HTMLInputElement,
  ocr_image: document.getElementById('toolOcr') as HTMLInputElement,
};

export async function fetchModels(): Promise<void> {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || 'https://api.deepseek.com';
  if (!apiKey) { showStatus(t('error.noApiKeySave'), 'error'); return; }

  refreshModelsBtn.disabled = true; refreshModelsBtn.textContent = t('status.loading');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'fetchModels', apiBase, apiKey }) as { success: boolean; models?: string[]; error?: string };
    const modelList = document.getElementById('model-list') as HTMLElement;
    modelList.innerHTML = '';
    if (response.success && response.models) { response.models.forEach(id => { const option = document.createElement('option'); option.value = id; modelList.appendChild(option); }); showStatus(t('status.modelsLoaded', { n: response.models!.length }), 'success'); }
    else showStatus(response.error || t('error.fetchModelsFailed'), 'error');
  } catch (e: unknown) { showStatus(t('error.fetchModelsFailed') + '：' + (e as Error).message, 'error'); }
  finally { refreshModelsBtn.disabled = false; refreshModelsBtn.textContent = t('settings.llm.refreshModels'); }
}

export function initLlmSettings(): void {
  refreshModelsBtn.addEventListener('click', fetchModels);
  // The per-tool list only matters when agent mode is on; dim it otherwise.
  const syncToolListVisibility = (): void => {
    agentToolsBox.classList.toggle('agent-tools-disabled', !agentModeInput.checked);
  };
  agentModeInput.addEventListener('change', syncToolListVisibility);
  syncToolListVisibility();
}

export function loadLlmValues(data: Record<string, unknown>): void {
  if (data.apiKey) apiKeyInput.value = data.apiKey as string;
  if (data.apiBase) apiBaseInput.value = data.apiBase as string;
  if (data.modelName) modelNameInput.value = data.modelName as string;
  if (data.systemPrompt) systemPromptInput.value = data.systemPrompt as string;
  visionEnabledInput.checked = data.visionEnabled === true;
  agentModeInput.checked = data.agentMode === true;
  const enabled = Array.isArray(data.enabledTools) ? (data.enabledTools as string[]) : null;
  for (const [name, input] of Object.entries(toolInputs)) {
    input.checked = enabled ? enabled.includes(name) : true; // default: all on
  }
  agentToolsBox.classList.toggle('agent-tools-disabled', !agentModeInput.checked);
}

/**
 * Set the per-tool checkboxes programmatically (settings import).
 * `null` = default (all enabled). Also refreshes the dimming state.
 */
export function applyAgentToolSelection(enabled: string[] | null): void {
  for (const [name, input] of Object.entries(toolInputs)) {
    input.checked = enabled ? enabled.includes(name) : true;
  }
  agentToolsBox.classList.toggle('agent-tools-disabled', !agentModeInput.checked);
}

export function collectLlmSaveData(): { error?: string; set?: Record<string, string | boolean | string[]>; remove?: string[] } {
  const apiKey = apiKeyInput.value.trim(); const apiBase = apiBaseInput.value.trim(); const modelName = modelNameInput.value.trim(); const systemPrompt = systemPromptInput.value.trim();
  if (!apiKey) return { error: t('error.noApiKeySave') };
  if (!apiKey.startsWith('sk-') && !apiBase) return { error: t('error.apiKeyHint') };
  const enabledTools = Object.entries(toolInputs).filter(([, input]) => input.checked).map(([name]) => name);
  const set: Record<string, string | boolean | string[]> = { apiKey, visionEnabled: visionEnabledInput.checked, agentMode: agentModeInput.checked, enabledTools }; const remove: string[] = [];
  if (apiBase) set.apiBase = apiBase; else remove.push('apiBase');
  if (modelName) set.modelName = modelName; else remove.push('modelName');
  if (systemPrompt) set.systemPrompt = systemPrompt; else remove.push('systemPrompt');
  return { set, remove };
}
