/**
 * Tests for options/quick-commands-editor.ts — CRUD + validation for /commands.
 *
 * Key logic: name validation (non-empty, no spaces/slashes, unique),
 * add/edit/delete operations, saveQuickCommands set/remove logic.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { setupOptionsDom } from './helpers/setup-options-dom';

vi.mock('../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../src/shared/constants.js', () => ({ escapeHtml: (s: string) => s }));
vi.mock('../../src/options/status.js', () => ({ showStatus: vi.fn() }));

import type * as QuickCommandsEditor from '../../src/options/quick-commands-editor';
import { showStatus } from '../../src/options/status';

// --- Chrome mock with local storage backing store ---
const localStorageData: Record<string, unknown> = { local: {} };

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get(keys: string[] | string, cb: (data: Record<string, unknown>) => void) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
          if ((localStorageData.local as Record<string, unknown>)[k] !== undefined) {
            result[k] = (localStorageData.local as Record<string, unknown>)[k];
          }
        });
        cb(result);
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.assign(localStorageData.local as Record<string, unknown>, items);
        cb?.();
      },
      remove(keys: string[] | string, cb?: () => void) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete (localStorageData.local as Record<string, unknown>)[k]);
        cb?.();
      },
    },
  },
});

describe('options/quick-commands-editor', () => {
  let mod: typeof QuickCommandsEditor;
  let listEl: HTMLElement;
  let addBtn: HTMLButtonElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    setupOptionsDom();
    // Clear stored commands between tests
    localStorageData.local = {};

    mod = await import('../../src/options/quick-commands-editor');
    listEl = document.getElementById('quickCommandsList') as HTMLElement;
    addBtn = document.getElementById('addCommandBtn') as HTMLButtonElement;

    // Initialize the editor (loads commands from storage + wires events)
    mod.initQuickCommandsEditor();
  });

  describe('saveQuickCommands()', () => {
    it('stores commands in chrome.storage.local when non-empty', () => {
      mod.saveQuickCommands([{ name: 'test', prompt: 'p' }]);
      expect((localStorageData.local as Record<string, unknown>).quickCommands).toEqual([
        { name: 'test', prompt: 'p' },
      ]);
    });

    it('removes from storage when commands array is empty', () => {
      // First set, then clear
      mod.saveQuickCommands([{ name: 'x', prompt: 'y' }]);
      mod.saveQuickCommands([]);
      expect((localStorageData.local as Record<string, unknown>).quickCommands).toBeUndefined();
    });
  });

  describe('renderCurrentCommands()', () => {
    it('renders empty state when no commands', () => {
      mod.renderCurrentCommands([]);
      expect(listEl.querySelector('.quick-commands-empty')).toBeTruthy();
    });

    it('renders command items with name and preview', () => {
      mod.renderCurrentCommands([
        { name: 'summarize', prompt: 'Summarize this page' },
      ]);
      const items = listEl.querySelectorAll('.quick-command-item');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('summarize');
    });

    it('truncates prompt preview to 50 characters', () => {
      const longPrompt = 'A'.repeat(100);
      mod.renderCurrentCommands([{ name: 'long', prompt: longPrompt }]);
      const preview = listEl.querySelector('.quick-command-preview')!;
      expect(preview.textContent!.length).toBeLessThanOrEqual(53); // 50 + '...'
    });
  });

  describe('add command flow', () => {
    it('shows edit form when add button is clicked', () => {
      addBtn.click();
      const form = listEl.querySelector('.quick-command-edit-form');
      expect(form).toBeTruthy();
    });

    it('shows error when saving with empty name', () => {
      addBtn.click();
      const nameInput = listEl.querySelector('.edit-name') as HTMLInputElement;
      const promptInput = listEl.querySelector('.edit-prompt') as HTMLTextAreaElement;
      const saveBtn = listEl.querySelector('.save-edit-btn') as HTMLButtonElement;

      nameInput.value = '';
      promptInput.value = 'some prompt';
      saveBtn.click();

      expect(showStatus).toHaveBeenCalledWith('[status.commandEmpty]', 'error');
    });

    it('shows error when saving with empty prompt', () => {
      addBtn.click();
      const nameInput = listEl.querySelector('.edit-name') as HTMLInputElement;
      const promptInput = listEl.querySelector('.edit-prompt') as HTMLTextAreaElement;
      const saveBtn = listEl.querySelector('.save-edit-btn') as HTMLButtonElement;

      nameInput.value = 'test';
      promptInput.value = '';
      saveBtn.click();

      expect(showStatus).toHaveBeenCalledWith('[status.commandEmpty]', 'error');
    });

    it('shows error when name contains spaces', () => {
      addBtn.click();
      const nameInput = listEl.querySelector('.edit-name') as HTMLInputElement;
      const promptInput = listEl.querySelector('.edit-prompt') as HTMLTextAreaElement;
      const saveBtn = listEl.querySelector('.save-edit-btn') as HTMLButtonElement;

      nameInput.value = 'has space';
      promptInput.value = 'prompt';
      saveBtn.click();

      expect(showStatus).toHaveBeenCalledWith('[status.commandInvalid]', 'error');
    });

    it('shows error when name contains slashes', () => {
      addBtn.click();
      const nameInput = listEl.querySelector('.edit-name') as HTMLInputElement;
      const promptInput = listEl.querySelector('.edit-prompt') as HTMLTextAreaElement;
      const saveBtn = listEl.querySelector('.save-edit-btn') as HTMLButtonElement;

      nameInput.value = 'has/slash';
      promptInput.value = 'prompt';
      saveBtn.click();

      expect(showStatus).toHaveBeenCalledWith('[status.commandInvalid]', 'error');
    });

    it('saves valid command and shows success status', () => {
      addBtn.click();
      const nameInput = listEl.querySelector('.edit-name') as HTMLInputElement;
      const promptInput = listEl.querySelector('.edit-prompt') as HTMLTextAreaElement;
      const saveBtn = listEl.querySelector('.save-edit-btn') as HTMLButtonElement;

      nameInput.value = 'valid';
      promptInput.value = 'valid prompt';
      saveBtn.click();

      expect(showStatus).toHaveBeenCalledWith('[status.commandSaved]', 'success');
      // Command should be persisted
      expect((localStorageData.local as Record<string, unknown>).quickCommands).toBeDefined();
    });
  });

  describe('delete command', () => {
    it('removes command when delete button is clicked', () => {
      // Seed a command
      mod.saveQuickCommands([{ name: 'todelete', prompt: 'p' }]);
      mod.renderCurrentCommands([{ name: 'todelete', prompt: 'p' }]);

      const deleteBtn = listEl.querySelector('.delete') as HTMLButtonElement;
      deleteBtn.click();

      expect(showStatus).toHaveBeenCalledWith('[status.commandDeleted]', 'success');
    });
  });
});
