import { t } from '../shared/i18n.js';
import { showStatus } from './status';
import { clearPageRecords } from '../shared/page-records-db';

const embeddingEnabledCheckbox = document.getElementById('embeddingEnabled') as HTMLInputElement;
const embeddingApiKeyInput = document.getElementById('embeddingApiKey') as HTMLInputElement;
const embeddingApiBaseInput = document.getElementById('embeddingApiBase') as HTMLInputElement;
const embeddingModelInput = document.getElementById('embeddingModel') as HTMLInputElement;
const embeddingThresholdInput = document.getElementById('embeddingThreshold') as HTMLInputElement;
const embeddingThresholdValue = document.getElementById('embeddingThresholdValue') as HTMLSpanElement;
const embeddingMaxPagesInput = document.getElementById('embeddingMaxPages') as HTMLInputElement;
const clearEmbeddingBtn = document.getElementById('clearEmbeddingBtn') as HTMLButtonElement;

export function initEmbeddingSettings(): void {
  embeddingThresholdInput.addEventListener('input', () => {
    embeddingThresholdValue.textContent = `${embeddingThresholdInput.value}%`;
  });

  clearEmbeddingBtn.addEventListener('click', () => {
    if (!confirm(t('settings.embedding.clearAll.confirm'))) return;
    clearPageRecords().then(() => {
      showStatus(t('settings.embedding.cleared'), 'success');
    });
  });
}

export function loadEmbeddingValues(data: Record<string, unknown>): void {
  if (data.embeddingEnabled !== undefined) embeddingEnabledCheckbox.checked = data.embeddingEnabled as boolean;
  if (data.embeddingApiKey) embeddingApiKeyInput.value = data.embeddingApiKey as string;
  if (data.embeddingApiBase) embeddingApiBaseInput.value = data.embeddingApiBase as string;
  if (data.embeddingModel) embeddingModelInput.value = data.embeddingModel as string;
  if (data.embeddingThreshold) {
    embeddingThresholdInput.value = String(Math.round((data.embeddingThreshold as number) * 100));
    embeddingThresholdValue.textContent = `${Math.round((data.embeddingThreshold as number) * 100)}%`;
  }
  if (data.embeddingMaxPages) embeddingMaxPagesInput.value = String(data.embeddingMaxPages);
}

export function collectEmbeddingSaveData(): { error?: string; set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];

  const enabled = embeddingEnabledCheckbox.checked;
  set.embeddingEnabled = enabled;

  const apiKey = embeddingApiKeyInput.value.trim();
  if (apiKey) set.embeddingApiKey = apiKey; else remove.push('embeddingApiKey');

  const apiBase = embeddingApiBaseInput.value.trim();
  if (apiBase) set.embeddingApiBase = apiBase; else remove.push('embeddingApiBase');

  const model = embeddingModelInput.value.trim();
  if (model) set.embeddingModel = model; else remove.push('embeddingModel');

  // When enabled, all three embedding fields are required — there is no longer
  // a fallback to the chat provider config. Surface the violation here so the
  // caller (options/index.ts) can block the save and show the status message.
  if (enabled && (!apiKey || !apiBase || !model)) {
    return { error: t('status.embeddingConfigIncomplete'), set, remove };
  }

  set.embeddingThreshold = parseInt(embeddingThresholdInput.value, 10) / 100;
  set.embeddingMaxPages = parseInt(embeddingMaxPagesInput.value, 10) || 200;

  return { set, remove };
}
