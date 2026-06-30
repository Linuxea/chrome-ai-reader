/**
 * DOM fixture for options page tests.
 *
 * All options modules call document.getElementById() at module load time
 * (top-level const assignments). This helper creates ALL required elements
 * so any options module can be imported without null-reference crashes.
 *
 * Usage in test files with vi.resetModules() + dynamic import pattern:
 *
 *   beforeEach(async () => {
 *     vi.resetModules();
 *     setupOptionsDom();
 *     const mod = await import('../../src/options/llm-settings.js');
 *   });
 */

/** IDs of all input/textarea elements used across options modules */
const TEXT_INPUT_IDS = [
  'apiKey', 'apiBase', 'modelName', 'systemPrompt',
  'ttsAppId', 'ttsAccessKey', 'ttsResourceId', 'podcastResourceId', 'ttsSpeaker',
  'ocrApiKey',
  'embeddingApiKey', 'embeddingApiBase', 'embeddingModel',
] as const;

/** IDs of all checkbox elements */
const CHECKBOX_IDS = [
  'suggestQuestions', 'ttsAutoPlay', 'embeddingEnabled', 'visionEnabled',
] as const;

/** IDs of all button elements */
const BUTTON_IDS = [
  'refreshModelsBtn', 'clearEmbeddingBtn',
  'addCommandBtn', 'exportBtn', 'importBtn',
  'saveBtn', 'themeToggleBtn',
] as const;

/** IDs of other element types */
const OTHER_IDS = [
  'model-list',          // <datalist>
  'embeddingThresholdValue', // <span>
  'embeddingThreshold',  // <input type="range">
  'embeddingMaxPages',   // <input type="number">
  'quickCommandsList',   // <div>
  'importFile',          // <input type="file">
  'status',              // <div>
  'themePicker',         // <div>
  'languageSelect',      // <select>
] as const;

/**
 * Populate document.body with all elements required by options modules.
 * Call this BEFORE importing any options module (they read elements at load time).
 */
export function setupOptionsDom(): void {
  const parts: string[] = [];

  for (const id of TEXT_INPUT_IDS) {
    // systemPrompt is a textarea, rest are inputs
    parts.push(id === 'systemPrompt'
      ? `<textarea id="${id}"></textarea>`
      : `<input id="${id}" type="text"/>`);
  }
  for (const id of CHECKBOX_IDS) {
    parts.push(`<input id="${id}" type="checkbox"/>`);
  }
  for (const id of BUTTON_IDS) {
    parts.push(`<button id="${id}">Btn</button>`);
  }
  // Other elements with specific types
  parts.push('<datalist id="model-list"></datalist>');
  parts.push('<span id="embeddingThresholdValue">75%</span>');
  parts.push('<input id="embeddingThreshold" type="range" value="75"/>');
  parts.push('<input id="embeddingMaxPages" type="number" value="200"/>');
  parts.push('<div id="quickCommandsList"></div>');
  parts.push('<input id="importFile" type="file"/>');
  parts.push('<div id="status"></div>');
  parts.push('<div id="themePicker"></div>');
  parts.push('<select id="languageSelect"><option value="zh">中文</option><option value="en">English</option></select>');

  document.body.innerHTML = parts.join('\n');
}
