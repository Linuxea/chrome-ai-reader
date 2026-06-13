/**
 * Tests for options/tts-settings.ts, ocr-settings.ts, suggest-settings.ts.
 *
 * These three modules are small and follow the same collect/load pattern.
 * Combined into one test file for efficiency.
 *
 * Uses vi.resetModules() + dynamic import because modules call
 * document.getElementById() at module load time.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { setupOptionsDom } from './helpers/setup-options-dom';

vi.mock('../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));

import type * as TtsSettings from '../../src/options/tts-settings';
import type * as OcrSettings from '../../src/options/ocr-settings';
import type * as SuggestSettings from '../../src/options/suggest-settings';

describe('options/tts-settings', () => {
  let mod: typeof TtsSettings;
  let ttsAppIdInput: HTMLInputElement;
  let ttsAccessKeyInput: HTMLInputElement;
  let ttsResourceIdInput: HTMLInputElement;
  let ttsSpeakerInput: HTMLInputElement;
  let ttsAutoPlayCheckbox: HTMLInputElement;

  beforeEach(async () => {
    vi.resetModules();
    setupOptionsDom();
    mod = await import('../../src/options/tts-settings');
    ttsAppIdInput = document.getElementById('ttsAppId') as HTMLInputElement;
    ttsAccessKeyInput = document.getElementById('ttsAccessKey') as HTMLInputElement;
    ttsResourceIdInput = document.getElementById('ttsResourceId') as HTMLInputElement;
    ttsSpeakerInput = document.getElementById('ttsSpeaker') as HTMLInputElement;
    ttsAutoPlayCheckbox = document.getElementById('ttsAutoPlay') as HTMLInputElement;
  });

  describe('collectTtsSaveData()', () => {
    it('includes filled fields in set and empty fields in remove', () => {
      ttsAppIdInput.value = 'app-id';
      ttsAccessKeyInput.value = 'access-key';
      ttsResourceIdInput.value = '';
      ttsSpeakerInput.value = '';
      ttsAutoPlayCheckbox.checked = true;

      const result = mod.collectTtsSaveData();
      expect(result.set.ttsAppId).toBe('app-id');
      expect(result.set.ttsAccessKey).toBe('access-key');
      expect(result.remove).toContain('ttsResourceId');
      expect(result.remove).toContain('ttsSpeaker');
      expect(result.set.ttsAutoPlay).toBe(true);
    });

    it('always includes ttsAutoPlay (even when false)', () => {
      ttsAutoPlayCheckbox.checked = false;
      const result = mod.collectTtsSaveData();
      expect(result.set.ttsAutoPlay).toBe(false);
    });
  });

  describe('loadTtsValues()', () => {
    it('populates form from storage data', () => {
      mod.loadTtsValues({
        ttsAppId: 'loaded-app',
        ttsAccessKey: 'loaded-key',
        ttsResourceId: 'loaded-res',
        ttsSpeaker: 'loaded-speaker',
        ttsAutoPlay: true,
      });
      expect(ttsAppIdInput.value).toBe('loaded-app');
      expect(ttsAutoPlayCheckbox.checked).toBe(true);
    });

    it('does not set checkbox when ttsAutoPlay is undefined', () => {
      ttsAutoPlayCheckbox.checked = true;
      mod.loadTtsValues({});
      expect(ttsAutoPlayCheckbox.checked).toBe(true);
    });
  });
});

describe('options/ocr-settings', () => {
  let mod: typeof OcrSettings;
  let ocrApiKeyInput: HTMLInputElement;

  beforeEach(async () => {
    vi.resetModules();
    setupOptionsDom();
    mod = await import('../../src/options/ocr-settings');
    ocrApiKeyInput = document.getElementById('ocrApiKey') as HTMLInputElement;
  });

  describe('collectOcrSaveData()', () => {
    it('returns set with ocrApiKey when value present', () => {
      ocrApiKeyInput.value = 'ocr-key-123';
      const result = mod.collectOcrSaveData();
      expect(result.set).toEqual({ ocrApiKey: 'ocr-key-123' });
      expect(result.remove).toEqual([]);
    });

    it('returns remove with ocrApiKey when value empty', () => {
      ocrApiKeyInput.value = '';
      const result = mod.collectOcrSaveData();
      expect(result.set).toEqual({});
      expect(result.remove).toEqual(['ocrApiKey']);
    });
  });

  describe('loadOcrValues()', () => {
    it('populates ocrApiKey from data', () => {
      mod.loadOcrValues({ ocrApiKey: 'loaded-ocr-key' });
      expect(ocrApiKeyInput.value).toBe('loaded-ocr-key');
    });
  });
});

describe('options/suggest-settings', () => {
  let mod: typeof SuggestSettings;
  let suggestCheckbox: HTMLInputElement;

  beforeEach(async () => {
    vi.resetModules();
    setupOptionsDom();
    mod = await import('../../src/options/suggest-settings');
    suggestCheckbox = document.getElementById('suggestQuestions') as HTMLInputElement;
  });

  describe('collectSuggestSaveData()', () => {
    it('always returns suggestQuestions in set', () => {
      suggestCheckbox.checked = true;
      expect(mod.collectSuggestSaveData().set).toEqual({ suggestQuestions: true });

      suggestCheckbox.checked = false;
      expect(mod.collectSuggestSaveData().set).toEqual({ suggestQuestions: false });
    });

    it('always returns empty remove array', () => {
      expect(mod.collectSuggestSaveData().remove).toEqual([]);
    });
  });

  describe('loadSuggestValues()', () => {
    it('sets checkbox from data', () => {
      mod.loadSuggestValues({ suggestQuestions: true });
      expect(suggestCheckbox.checked).toBe(true);

      mod.loadSuggestValues({ suggestQuestions: false });
      expect(suggestCheckbox.checked).toBe(false);
    });
  });
});
