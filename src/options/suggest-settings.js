// suggest-settings.js — 推荐追问开关

const suggestQuestionsCheckbox = document.getElementById('suggestQuestions');

export function initSuggestSettings() {
  suggestQuestionsCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ suggestQuestions: suggestQuestionsCheckbox.checked });
  });
}

export function loadSuggestValues(data) {
  if (data.suggestQuestions !== undefined) suggestQuestionsCheckbox.checked = data.suggestQuestions;
}

export function collectSuggestSaveData() {
  return { set: { suggestQuestions: suggestQuestionsCheckbox.checked }, remove: [] };
}
