import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock i18n
vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

// Mock chrome
const storageListeners = { sync: new Set() };
const store = { sync: {} };

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys, cb) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store.sync[k] !== undefined) result[k] = store.sync[k]; });
        cb(result);
      },
      set(items, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: store.sync[k], newValue: v };
          store.sync[k] = v;
        }
        storageListeners.sync.forEach(fn => fn(changes, 'sync'));
        cb?.();
      },
    },
    onChanged: {
      addListener(fn) { storageListeners.sync.add(fn); },
      removeListener(fn) { storageListeners.sync.delete(fn); },
    },
  },
});

// Must import initModelStatus first to set _modelStatusBar, then test updateModelStatusBar
import { initModelStatus, updateModelStatusBar } from '../../../src/side_panel/ui/model-status.js';

describe('ui/model-status', () => {
  let statusBar;

  beforeEach(() => {
    document.body.innerHTML = '';
    store.sync.modelName = undefined;
    storageListeners.sync.clear();

    statusBar = document.createElement('div');
    statusBar.id = 'modelStatusBar';
    document.body.appendChild(statusBar);

    // Must call initModelStatus to set the internal _modelStatusBar reference
    initModelStatus();
    vi.clearAllMocks();
  });

  describe('updateModelStatusBar', () => {
    it('displays model name with label', () => {
      updateModelStatusBar('gpt-4');
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]gpt-4');
    });

    it('defaults to deepseek-chat when no name provided', () => {
      updateModelStatusBar(undefined);
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]deepseek-chat');
    });

    it('defaults to deepseek-chat when null provided', () => {
      updateModelStatusBar(null);
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]deepseek-chat');
    });

    it('defaults to deepseek-chat when empty string provided', () => {
      updateModelStatusBar('');
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]deepseek-chat');
    });
  });

  describe('initModelStatus', () => {
    it('loads model name from chrome.storage on init', () => {
      // init already called in beforeEach; re-init with new store value
      store.sync.modelName = 'gpt-4o';
      initModelStatus();
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]gpt-4o');
    });

    it('defaults when no model name in storage', () => {
      store.sync.modelName = undefined;
      initModelStatus();
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]deepseek-chat');
    });

    it('updates on chrome.storage.onChanged for modelName', () => {
      initModelStatus();
      const listener = [...storageListeners.sync][0];

      listener({ modelName: { newValue: 'claude-3', oldValue: undefined } }, 'sync');
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]claude-3');
    });

    it('ignores changes for other keys', () => {
      initModelStatus();
      const listener = [...storageListeners.sync][0];

      listener({ apiKey: { newValue: 'sk-xxx' } }, 'sync');
      expect(statusBar.textContent).toBe('[sidebar.modelStatus]deepseek-chat');
    });
  });
});
