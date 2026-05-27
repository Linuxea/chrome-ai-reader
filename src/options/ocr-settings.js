// ocr-settings.js — OCR 文字识别配置（API Key）

const ocrApiKeyInput = document.getElementById('ocrApiKey');

export function initOcrSettings() {
  // OCR 目前没有即时保存的交互，预留初始化入口
}

export function loadOcrValues(data) {
  if (data.ocrApiKey) ocrApiKeyInput.value = data.ocrApiKey;
}

export function collectOcrSaveData() {
  const ocrApiKey = ocrApiKeyInput.value.trim();
  if (ocrApiKey) {
    return { set: { ocrApiKey }, remove: [] };
  }
  return { set: {}, remove: ['ocrApiKey'] };
}
