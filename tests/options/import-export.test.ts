/**
 * Tests for options/import-export.ts — JSON settings export/import.
 *
 * Export: reads sync+local storage, constructs versioned JSON, triggers download.
 * Import: parses JSON, validates version, populates form, writes to storage.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { setupOptionsDom } from './helpers/setup-options-dom';

vi.mock('../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../src/shared/download.js', () => ({ downloadFile: vi.fn() }));
vi.mock('../../src/options/status.js', () => ({ showStatus: vi.fn() }));
vi.mock('../../src/options/llm-settings.js', () => ({ fetchModels: vi.fn() }));

import type * as ImportExport from '../../src/options/import-export';
import { downloadFile } from '../../src/shared/download.js';
import { showStatus } from '../../src/options/status';

// --- Chrome mock with sync + local backing store ---
const store: Record<string, Record<string, unknown>> = { sync: {}, local: {} };

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys: string[] | string | null, cb: (data: Record<string, unknown>) => void) {
        const result: Record<string, unknown> = {};
        if (keys == null) Object.assign(result, store.sync);
        else {
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach(k => { if (store.sync[k] !== undefined) result[k] = store.sync[k]; });
        }
        cb(result);
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.assign(store.sync, items); cb?.();
      },
      remove(keys: string[] | string, cb?: () => void) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete store.sync[k]); cb?.();
      },
    },
    local: {
      get(keys: string[] | string, cb: (data: Record<string, unknown>) => void) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store.local[k] !== undefined) result[k] = store.local[k]; });
        cb(result);
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.assign(store.local, items); cb?.();
      },
      remove(keys: string[] | string, cb?: () => void) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete store.local[k]); cb?.();
      },
    },
  },
});

describe('options/import-export', () => {
  let mod: typeof ImportExport;
  let exportBtn: HTMLButtonElement;
  let importBtn: HTMLButtonElement;
  let importFile: HTMLInputElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    setupOptionsDom();
    store.sync = {};
    store.local = {};

    mod = await import('../../src/options/import-export');
    mod.initImportExport();

    exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
    importBtn = document.getElementById('importBtn') as HTMLButtonElement;
    importFile = document.getElementById('importFile') as HTMLInputElement;
  });

  describe('export', () => {
    it('triggers download with versioned JSON when export clicked', () => {
      store.sync = { apiKey: 'sk-test', modelName: 'gpt-4' };

      exportBtn.click();

      expect(downloadFile).toHaveBeenCalledTimes(1);
      const [jsonStr, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
      const parsed = JSON.parse(jsonStr as string);
      expect(parsed.version).toBe(1);
      expect(parsed.apiKey).toBe('sk-test');
      expect(parsed.modelName).toBe('gpt-4');
      expect(filename).toContain('ai-reader-settings-');
      expect(mimeType).toBe('application/json');
    });

    it('includes quickCommands from local storage when present', () => {
      store.sync = { apiKey: 'sk-test' };
      store.local = { quickCommands: [{ name: 'cmd', prompt: 'p' }] };

      exportBtn.click();

      const [, , , ] = vi.mocked(downloadFile).mock.calls[0];
      const parsed = JSON.parse(vi.mocked(downloadFile).mock.calls[0][0] as string);
      expect(parsed.quickCommands).toEqual([{ name: 'cmd', prompt: 'p' }]);
    });

    it('shows success status after export', () => {
      store.sync = {};
      exportBtn.click();
      expect(showStatus).toHaveBeenCalledWith('[status.exported]', 'success');
    });

    it('excludes undefined/empty fields from export', () => {
      store.sync = { apiKey: 'sk-test', apiBase: undefined as unknown as string };

      exportBtn.click();

      const parsed = JSON.parse(vi.mocked(downloadFile).mock.calls[0][0] as string);
      expect(parsed.apiKey).toBe('sk-test');
      expect(parsed).not.toHaveProperty('apiBase');
    });
  });

  describe('import — file selection', () => {
    it('opens file dialog when import button clicked', () => {
      const clickSpy = vi.spyOn(importFile, 'click');
      importBtn.click();
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('import — parsing', () => {
    /**
     * Simulate selecting a file and triggering the change handler.
     * FileReader.onload is called asynchronously.
     */
    function simulateFileSelect(jsonContent: string) {
      // Mock FileReader to invoke onload synchronously
      const fileReader = {
        onload: null as ((evt: unknown) => void) | null,
        readAsText: vi.fn(function (this: typeof fileReader) {
          // Simulate successful read
          this.onload?.({ target: { result: jsonContent } });
        }),
      };
      vi.stubGlobal('FileReader', function () { return fileReader; });

      // Set up a fake file
      Object.defineProperty(importFile, 'files', {
        value: [new File([jsonContent], 'settings.json', { type: 'application/json' })],
        configurable: true,
      });

      importFile.dispatchEvent(new Event('change'));
    }

    it('imports valid JSON and writes to storage', () => {
      const importData = JSON.stringify({
        version: 1,
        apiKey: 'sk-imported',
        modelName: 'imported-model',
      });

      simulateFileSelect(importData);

      expect(showStatus).toHaveBeenCalledWith('[status.imported]', 'success');
      // Storage should have been updated
      expect(store.sync.apiKey).toBe('sk-imported');
    });

    it('shows error for invalid JSON', () => {
      simulateFileSelect('not valid json {{{');

      expect(showStatus).toHaveBeenCalledWith(
        expect.stringContaining('[status.parseError]'),
        'error',
      );
    });

    it('shows error when version is missing', () => {
      simulateFileSelect(JSON.stringify({ apiKey: 'sk-test' }));

      expect(showStatus).toHaveBeenCalledWith('[status.invalidFile]', 'error');
    });

    it('imports quickCommands when present in import data', () => {
      simulateFileSelect(JSON.stringify({
        version: 1,
        apiKey: 'sk-test',
        quickCommands: [{ name: 'imported', prompt: 'p' }],
      }));

      expect(store.local.quickCommands).toEqual([{ name: 'imported', prompt: 'p' }]);
    });
  });
});
