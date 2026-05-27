// fields.js — 所有设置字段的 DOM 引用和字段名列表
// 各 section 和 import-export 共用，避免重复获取 DOM 元素

export const textFields = {
  apiKey: document.getElementById('apiKey'),
  apiBase: document.getElementById('apiBase'),
  modelName: document.getElementById('modelName'),
  systemPrompt: document.getElementById('systemPrompt'),
  ttsAppId: document.getElementById('ttsAppId'),
  ttsAccessKey: document.getElementById('ttsAccessKey'),
  ttsResourceId: document.getElementById('ttsResourceId'),
  ttsSpeaker: document.getElementById('ttsSpeaker'),
  ocrApiKey: document.getElementById('ocrApiKey'),
};

export const checkboxFields = {
  suggestQuestions: document.getElementById('suggestQuestions'),
  ttsAutoPlay: document.getElementById('ttsAutoPlay'),
};

export const SYNC_FIELDS = [...Object.keys(textFields), ...Object.keys(checkboxFields), 'themeName', 'language'];
