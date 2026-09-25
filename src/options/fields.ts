export const textFields: Record<string, HTMLInputElement | HTMLTextAreaElement> = {
  apiKey: document.getElementById('apiKey') as HTMLInputElement,
  apiBase: document.getElementById('apiBase') as HTMLInputElement,
  modelName: document.getElementById('modelName') as HTMLInputElement,
  systemPrompt: document.getElementById('systemPrompt') as HTMLTextAreaElement,
  ttsAppId: document.getElementById('ttsAppId') as HTMLInputElement,
  ttsAccessKey: document.getElementById('ttsAccessKey') as HTMLInputElement,
  ttsResourceId: document.getElementById('ttsResourceId') as HTMLInputElement,
  podcastResourceId: document.getElementById('podcastResourceId') as HTMLInputElement,
  ttsSpeaker: document.getElementById('ttsSpeaker') as HTMLInputElement,
  embeddingApiKey: document.getElementById('embeddingApiKey') as HTMLInputElement,
  embeddingApiBase: document.getElementById('embeddingApiBase') as HTMLInputElement,
  embeddingModel: document.getElementById('embeddingModel') as HTMLInputElement,
};

export const checkboxFields: Record<string, HTMLInputElement> = {
  suggestQuestions: document.getElementById('suggestQuestions') as HTMLInputElement,
  ttsAutoPlay: document.getElementById('ttsAutoPlay') as HTMLInputElement,
  embeddingEnabled: document.getElementById('embeddingEnabled') as HTMLInputElement,
};

/**
 * Credentials. Left out of settings exports unless the user opts in (the
 * export is a plain-text file), and never cleared by an import that lacks
 * them — so re-importing a redacted backup keeps the keys already configured.
 */
export { SECRET_KEYS as SECRET_FIELDS } from '../platform/settings';

export const SYNC_FIELDS: string[] = [...Object.keys(textFields), ...Object.keys(checkboxFields), 'themeName', 'language', 'embeddingThreshold', 'embeddingMaxPages'];
