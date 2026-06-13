/**
 * Tests for options/llm-settings.ts — LLM API config + validation.
 *
 * Uses vi.resetModules() + dynamic import because llm-settings.ts calls
 * document.getElementById() at module load time (top-level const assignments).
 * setupOptionsDom() must run BEFORE the import.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { setupOptionsDom } from './helpers/setup-options-dom';

// Mock i18n (avoids chrome.storage.onChanged side effect at module load)
vi.mock('../../src/shared/i18n.js', () => ({
  t: (key: string) => `[${key}]`,
}));

import type * as LlmSettings from '../../src/options/llm-settings';

describe('options/llm-settings', () => {
  let mod: typeof LlmSettings;
  let apiKeyInput: HTMLInputElement;
  let apiBaseInput: HTMLInputElement;
  let modelNameInput: HTMLInputElement;
  let systemPromptInput: HTMLTextAreaElement;

  beforeEach(async () => {
    vi.resetModules();
    setupOptionsDom();
    mod = await import('../../src/options/llm-settings');

    apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    apiBaseInput = document.getElementById('apiBase') as HTMLInputElement;
    modelNameInput = document.getElementById('modelName') as HTMLInputElement;
    systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
  });

  describe('collectLlmSaveData()', () => {
    it('returns error when apiKey is empty', () => {
      apiKeyInput.value = '';
      const result = mod.collectLlmSaveData();
      expect(result.error).toBe('[error.noApiKeySave]');
    });

    it('returns error when apiKey is whitespace-only', () => {
      apiKeyInput.value = '   ';
      const result = mod.collectLlmSaveData();
      expect(result.error).toBe('[error.noApiKeySave]');
    });

    it('returns error when apiKey does not start with sk- and no apiBase', () => {
      apiKeyInput.value = 'my-custom-key';
      apiBaseInput.value = '';
      const result = mod.collectLlmSaveData();
      expect(result.error).toBe('[error.apiKeyHint]');
    });

    it('accepts non-sk key when apiBase is provided', () => {
      apiKeyInput.value = 'custom-key';
      apiBaseInput.value = 'https://api.custom.com';
      const result = mod.collectLlmSaveData();
      expect(result.error).toBeUndefined();
      expect(result.set!.apiKey).toBe('custom-key');
    });

    it('accepts standard sk- key without apiBase', () => {
      apiKeyInput.value = 'sk-test123';
      apiBaseInput.value = '';
      const result = mod.collectLlmSaveData();
      expect(result.error).toBeUndefined();
      expect(result.set!.apiKey).toBe('sk-test123');
    });

    it('includes apiBase in set when provided', () => {
      apiKeyInput.value = 'sk-test';
      apiBaseInput.value = 'https://api.test.com';
      const result = mod.collectLlmSaveData();
      expect(result.set!.apiBase).toBe('https://api.test.com');
    });

    it('adds apiBase to remove list when empty', () => {
      apiKeyInput.value = 'sk-test';
      apiBaseInput.value = '';
      const result = mod.collectLlmSaveData();
      expect(result.remove).toContain('apiBase');
      expect(result.set).not.toHaveProperty('apiBase');
    });

    it('includes modelName in set when provided', () => {
      apiKeyInput.value = 'sk-test';
      modelNameInput.value = 'gpt-4';
      const result = mod.collectLlmSaveData();
      expect(result.set!.modelName).toBe('gpt-4');
    });

    it('adds modelName to remove list when empty', () => {
      apiKeyInput.value = 'sk-test';
      modelNameInput.value = '';
      const result = mod.collectLlmSaveData();
      expect(result.remove).toContain('modelName');
    });

    it('includes systemPrompt in set when provided', () => {
      apiKeyInput.value = 'sk-test';
      systemPromptInput.value = 'Be concise';
      const result = mod.collectLlmSaveData();
      expect(result.set!.systemPrompt).toBe('Be concise');
    });

    it('adds systemPrompt to remove list when empty', () => {
      apiKeyInput.value = 'sk-test';
      systemPromptInput.value = '';
      const result = mod.collectLlmSaveData();
      expect(result.remove).toContain('systemPrompt');
    });

    it('trims all values before saving', () => {
      apiKeyInput.value = '  sk-test  ';
      apiBaseInput.value = '  https://api.test.com  ';
      modelNameInput.value = '  gpt-4  ';
      const result = mod.collectLlmSaveData();
      expect(result.set!.apiKey).toBe('sk-test');
      expect(result.set!.apiBase).toBe('https://api.test.com');
      expect(result.set!.modelName).toBe('gpt-4');
    });
  });

  describe('loadLlmValues()', () => {
    it('populates form fields from storage data', () => {
      mod.loadLlmValues({
        apiKey: 'sk-loaded',
        apiBase: 'https://loaded.com',
        modelName: 'loaded-model',
        systemPrompt: 'loaded prompt',
      });
      expect(apiKeyInput.value).toBe('sk-loaded');
      expect(apiBaseInput.value).toBe('https://loaded.com');
      expect(modelNameInput.value).toBe('loaded-model');
      expect(systemPromptInput.value).toBe('loaded prompt');
    });

    it('does not overwrite fields when data is missing', () => {
      apiKeyInput.value = 'existing';
      mod.loadLlmValues({});
      expect(apiKeyInput.value).toBe('existing');
    });
  });
});
