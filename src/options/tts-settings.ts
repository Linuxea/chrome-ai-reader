import { t } from '../shared/i18n.js';
import { formatBytes } from '../shared/format';
import { clearTtsCache, estimateTtsCacheBytes } from '../shared/tts-cache';

const ttsAppIdInput = document.getElementById('ttsAppId') as HTMLInputElement;
const ttsAccessKeyInput = document.getElementById('ttsAccessKey') as HTMLInputElement;
const ttsResourceIdInput = document.getElementById('ttsResourceId') as HTMLInputElement;
const podcastResourceIdInput = document.getElementById('podcastResourceId') as HTMLInputElement;
const ttsSpeakerInput = document.getElementById('ttsSpeaker') as HTMLInputElement;
const ttsAutoPlayCheckbox = document.getElementById('ttsAutoPlay') as HTMLInputElement;
const podcastDirectCheckbox = document.getElementById('podcastDirect') as HTMLInputElement | null;
const ttsCacheSizeEl = document.getElementById('ttsCacheSize');
const ttsClearCacheBtn = document.getElementById('ttsClearCacheBtn') as HTMLButtonElement | null;

async function refreshTtsCacheSize(): Promise<void> {
  if (!ttsCacheSizeEl) return;
  try {
    ttsCacheSizeEl.textContent = formatBytes(await estimateTtsCacheBytes());
  } catch {
    ttsCacheSizeEl.textContent = '–';
  }
}

export function initTtsSettings(): void {
  ttsAutoPlayCheckbox.addEventListener('change', () => { chrome.storage.sync.set({ ttsAutoPlay: ttsAutoPlayCheckbox.checked }); });
  ttsClearCacheBtn?.addEventListener('click', async () => {
    if (!ttsClearCacheBtn) return;
    ttsClearCacheBtn.disabled = true;
    try {
      await clearTtsCache();
      ttsClearCacheBtn.textContent = t('status.ttsCacheCleared');
      await refreshTtsCacheSize();
      setTimeout(() => { ttsClearCacheBtn.textContent = t('settings.tts.cache.clear'); }, 1500);
    } catch {
      ttsClearCacheBtn.disabled = false;
    }
    ttsClearCacheBtn.disabled = false;
  });
  void refreshTtsCacheSize();
}

export function loadTtsValues(data: Record<string, unknown>): void {
  if (data.ttsAppId) ttsAppIdInput.value = data.ttsAppId as string;
  if (data.ttsAccessKey) ttsAccessKeyInput.value = data.ttsAccessKey as string;
  if (data.ttsResourceId) ttsResourceIdInput.value = data.ttsResourceId as string;
  if (data.podcastResourceId) podcastResourceIdInput.value = data.podcastResourceId as string;
  if (data.ttsSpeaker) ttsSpeakerInput.value = data.ttsSpeaker as string;
  if (data.ttsAutoPlay !== undefined) ttsAutoPlayCheckbox.checked = data.ttsAutoPlay as boolean;
  if (podcastDirectCheckbox && data.podcastDirect !== undefined) podcastDirectCheckbox.checked = data.podcastDirect as boolean;
  void refreshTtsCacheSize();
}

export function collectTtsSaveData(): { set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {}; const remove: string[] = [];
  const fields = [{ input: ttsAppIdInput, key: 'ttsAppId' }, { input: ttsAccessKeyInput, key: 'ttsAccessKey' }, { input: ttsResourceIdInput, key: 'ttsResourceId' }, { input: podcastResourceIdInput, key: 'podcastResourceId' }, { input: ttsSpeakerInput, key: 'ttsSpeaker' }];
  for (const { input, key } of fields) { const val = input.value.trim(); if (val) set[key] = val; else remove.push(key); }
  set.ttsAutoPlay = ttsAutoPlayCheckbox.checked;
  if (podcastDirectCheckbox) set.podcastDirect = podcastDirectCheckbox.checked;
  return { set, remove };
}
