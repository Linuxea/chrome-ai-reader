/**
 * Tests for options/embedding-settings.ts — embedding config + threshold conversion.
 *
 * Uses vi.hoisted for DOM setup (before module import) instead of vi.resetModules,
 * because we need stable mock references for clearAllPageRecords assertions.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Set up DOM BEFORE module import ---
// embedding-settings.ts calls document.getElementById at module load time.
vi.hoisted(() => {
  document.body.innerHTML = `
    <input id="embeddingEnabled" type="checkbox"/>
    <input id="embeddingApiKey" type="text"/>
    <input id="embeddingApiBase" type="text"/>
    <input id="embeddingModel" type="text"/>
    <input id="embeddingThreshold" type="range" value="75"/>
    <span id="embeddingThresholdValue">75%</span>
    <input id="embeddingMaxPages" type="number" value="200"/>
    <button id="clearEmbeddingBtn">Clear</button>
  `;
});

vi.mock('../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../src/shared/constants.js', () => ({ escapeHtml: (s: string) => s }));
vi.mock('../../src/side_panel/features/related-pages.js', () => ({
  clearAllPageRecords: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../src/options/status.js', () => ({ showStatus: vi.fn() }));

import {
  collectEmbeddingSaveData,
  loadEmbeddingValues,
  initEmbeddingSettings,
} from '../../src/options/embedding-settings';
import { clearAllPageRecords } from '../../src/side_panel/features/related-pages.js';

describe('options/embedding-settings', () => {
  let enabledCheckbox: HTMLInputElement;
  let apiKeyInput: HTMLInputElement;
  let apiBaseInput: HTMLInputElement;
  let modelInput: HTMLInputElement;
  let thresholdInput: HTMLInputElement;
  let maxPagesInput: HTMLInputElement;
  let clearBtn: HTMLButtonElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset form values
    enabledCheckbox = document.getElementById('embeddingEnabled') as HTMLInputElement;
    apiKeyInput = document.getElementById('embeddingApiKey') as HTMLInputElement;
    apiBaseInput = document.getElementById('embeddingApiBase') as HTMLInputElement;
    modelInput = document.getElementById('embeddingModel') as HTMLInputElement;
    thresholdInput = document.getElementById('embeddingThreshold') as HTMLInputElement;
    maxPagesInput = document.getElementById('embeddingMaxPages') as HTMLInputElement;
    clearBtn = document.getElementById('clearEmbeddingBtn') as HTMLButtonElement;

    enabledCheckbox.checked = false;
    apiKeyInput.value = '';
    apiBaseInput.value = '';
    modelInput.value = '';
    thresholdInput.value = '75';
    maxPagesInput.value = '200';
  });

  describe('collectEmbeddingSaveData()', () => {
    it('always includes embeddingEnabled in set', () => {
      enabledCheckbox.checked = true;
      expect(collectEmbeddingSaveData().set.embeddingEnabled).toBe(true);
      enabledCheckbox.checked = false;
      expect(collectEmbeddingSaveData().set.embeddingEnabled).toBe(false);
    });

    it('converts threshold from percentage to decimal (75 → 0.75)', () => {
      thresholdInput.value = '75';
      expect(collectEmbeddingSaveData().set.embeddingThreshold).toBe(0.75);
    });

    it('converts threshold for 0% and 100%', () => {
      thresholdInput.value = '0';
      expect(collectEmbeddingSaveData().set.embeddingThreshold).toBe(0);
      thresholdInput.value = '100';
      expect(collectEmbeddingSaveData().set.embeddingThreshold).toBe(1);
    });

    it('includes maxPages from input', () => {
      maxPagesInput.value = '500';
      expect(collectEmbeddingSaveData().set.embeddingMaxPages).toBe(500);
    });

    it('defaults maxPages to 200 when input is empty or invalid', () => {
      maxPagesInput.value = '';
      expect(collectEmbeddingSaveData().set.embeddingMaxPages).toBe(200);
      maxPagesInput.value = 'abc';
      expect(collectEmbeddingSaveData().set.embeddingMaxPages).toBe(200);
    });

    it('includes apiKey in set when present, in remove when empty', () => {
      apiKeyInput.value = 'emb-key';
      expect(collectEmbeddingSaveData().set.embeddingApiKey).toBe('emb-key');

      apiKeyInput.value = '';
      expect(collectEmbeddingSaveData().remove).toContain('embeddingApiKey');
    });

    it('includes apiBase and model conditionally in set/remove', () => {
      apiBaseInput.value = 'https://emb.api';
      modelInput.value = 'doubao-emb';
      const r1 = collectEmbeddingSaveData();
      expect(r1.set.embeddingApiBase).toBe('https://emb.api');
      expect(r1.set.embeddingModel).toBe('doubao-emb');

      apiBaseInput.value = '';
      modelInput.value = '';
      const r2 = collectEmbeddingSaveData();
      expect(r2.remove).toContain('embeddingApiBase');
      expect(r2.remove).toContain('embeddingModel');
    });
  });

  describe('loadEmbeddingValues()', () => {
    it('populates form and converts threshold from decimal to percentage', () => {
      loadEmbeddingValues({
        embeddingEnabled: true,
        embeddingApiKey: 'key',
        embeddingApiBase: 'https://base',
        embeddingModel: 'model',
        embeddingThreshold: 0.65,
        embeddingMaxPages: 300,
      });
      expect(enabledCheckbox.checked).toBe(true);
      expect(apiKeyInput.value).toBe('key');
      expect(thresholdInput.value).toBe('65');
      const thresholdValue = document.getElementById('embeddingThresholdValue')!;
      expect(thresholdValue.textContent).toBe('65%');
      expect(maxPagesInput.value).toBe('300');
    });

    it('does not set checkbox when embeddingEnabled is undefined', () => {
      enabledCheckbox.checked = true;
      loadEmbeddingValues({});
      expect(enabledCheckbox.checked).toBe(true);
    });
  });

  describe('initEmbeddingSettings() — clear all records', () => {
    it('calls clearAllPageRecords when confirmed', () => {
      initEmbeddingSettings();
      globalThis.confirm = () => true;
      clearBtn.click();
      expect(clearAllPageRecords).toHaveBeenCalled();
    });

    it('does nothing when confirm is dismissed', () => {
      initEmbeddingSettings();
      globalThis.confirm = () => false;
      clearBtn.click();
      expect(clearAllPageRecords).not.toHaveBeenCalled();
    });
  });
});
