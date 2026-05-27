const ttsAppIdInput = document.getElementById('ttsAppId') as HTMLInputElement;
const ttsAccessKeyInput = document.getElementById('ttsAccessKey') as HTMLInputElement;
const ttsResourceIdInput = document.getElementById('ttsResourceId') as HTMLInputElement;
const ttsSpeakerInput = document.getElementById('ttsSpeaker') as HTMLInputElement;
const ttsAutoPlayCheckbox = document.getElementById('ttsAutoPlay') as HTMLInputElement;

export function initTtsSettings(): void { ttsAutoPlayCheckbox.addEventListener('change', () => { chrome.storage.sync.set({ ttsAutoPlay: ttsAutoPlayCheckbox.checked }); }); }

export function loadTtsValues(data: Record<string, unknown>): void {
  if (data.ttsAppId) ttsAppIdInput.value = data.ttsAppId as string;
  if (data.ttsAccessKey) ttsAccessKeyInput.value = data.ttsAccessKey as string;
  if (data.ttsResourceId) ttsResourceIdInput.value = data.ttsResourceId as string;
  if (data.ttsSpeaker) ttsSpeakerInput.value = data.ttsSpeaker as string;
  if (data.ttsAutoPlay !== undefined) ttsAutoPlayCheckbox.checked = data.ttsAutoPlay as boolean;
}

export function collectTtsSaveData(): { set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {}; const remove: string[] = [];
  const fields = [{ input: ttsAppIdInput, key: 'ttsAppId' }, { input: ttsAccessKeyInput, key: 'ttsAccessKey' }, { input: ttsResourceIdInput, key: 'ttsResourceId' }, { input: ttsSpeakerInput, key: 'ttsSpeaker' }];
  for (const { input, key } of fields) { const val = input.value.trim(); if (val) set[key] = val; else remove.push(key); }
  set.ttsAutoPlay = ttsAutoPlayCheckbox.checked;
  return { set, remove };
}
