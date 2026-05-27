const suggestQuestionsCheckbox = document.getElementById('suggestQuestions') as HTMLInputElement;

export function initSuggestSettings(): void { suggestQuestionsCheckbox.addEventListener('change', () => { chrome.storage.sync.set({ suggestQuestions: suggestQuestionsCheckbox.checked }); }); }

export function loadSuggestValues(data: Record<string, unknown>): void { if (data.suggestQuestions !== undefined) suggestQuestionsCheckbox.checked = data.suggestQuestions as boolean; }

export function collectSuggestSaveData(): { set: Record<string, boolean>; remove: string[] } { return { set: { suggestQuestions: suggestQuestionsCheckbox.checked }, remove: [] }; }
