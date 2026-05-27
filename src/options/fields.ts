export const textFields: Record<string, HTMLInputElement | HTMLTextAreaElement> = {
  apiKey: document.getElementById('apiKey') as HTMLInputElement,
  apiBase: document.getElementById('apiBase') as HTMLInputElement,
  modelName: document.getElementById('modelName') as HTMLInputElement,
  systemPrompt: document.getElementById('systemPrompt') as HTMLTextAreaElement,
  ttsAppId: document.getElementById('ttsAppId') as HTMLInputElement,
  ttsAccessKey: document.getElementById('ttsAccessKey') as HTMLInputElement,
  ttsResourceId: document.getElementById('ttsResourceId') as HTMLInputElement,
  ttsSpeaker: document.getElementById('ttsSpeaker') as HTMLInputElement,
  ocrApiKey: document.getElementById('ocrApiKey') as HTMLInputElement,
};

export const checkboxFields: Record<string, HTMLInputElement> = {
  suggestQuestions: document.getElementById('suggestQuestions') as HTMLInputElement,
  ttsAutoPlay: document.getElementById('ttsAutoPlay') as HTMLInputElement,
};

export const SYNC_FIELDS: string[] = [...Object.keys(textFields), ...Object.keys(checkboxFields), 'themeName', 'language'];
