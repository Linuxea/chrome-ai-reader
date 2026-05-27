// tts-settings.js — TTS 语音合成配置（AppId / AccessKey / ResourceId / Speaker / AutoPlay）

const ttsAppIdInput = document.getElementById('ttsAppId');
const ttsAccessKeyInput = document.getElementById('ttsAccessKey');
const ttsResourceIdInput = document.getElementById('ttsResourceId');
const ttsSpeakerInput = document.getElementById('ttsSpeaker');
const ttsAutoPlayCheckbox = document.getElementById('ttsAutoPlay');

export function initTtsSettings() {
  // 复选框即时保存
  ttsAutoPlayCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ ttsAutoPlay: ttsAutoPlayCheckbox.checked });
  });
}

export function loadTtsValues(data) {
  if (data.ttsAppId) ttsAppIdInput.value = data.ttsAppId;
  if (data.ttsAccessKey) ttsAccessKeyInput.value = data.ttsAccessKey;
  if (data.ttsResourceId) ttsResourceIdInput.value = data.ttsResourceId;
  if (data.ttsSpeaker) ttsSpeakerInput.value = data.ttsSpeaker;
  if (data.ttsAutoPlay !== undefined) ttsAutoPlayCheckbox.checked = data.ttsAutoPlay;
}

export function collectTtsSaveData() {
  const set = {};
  const remove = [];

  const fields = [
    { input: ttsAppIdInput, key: 'ttsAppId' },
    { input: ttsAccessKeyInput, key: 'ttsAccessKey' },
    { input: ttsResourceIdInput, key: 'ttsResourceId' },
    { input: ttsSpeakerInput, key: 'ttsSpeaker' },
  ];

  for (const { input, key } of fields) {
    const val = input.value.trim();
    if (val) { set[key] = val; } else { remove.push(key); }
  }

  set.ttsAutoPlay = ttsAutoPlayCheckbox.checked;

  return { set, remove };
}
