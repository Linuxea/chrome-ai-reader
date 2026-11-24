/**
 * settings-store — the immediate-save semantics (D-2) that the legacy
 * collectLlmSaveData / collectTtsSaveData encoded, frozen as tests:
 * toggle-on-change, debounced text persist, empty → remove, retired-key
 * sweep, and the apiKey → refreshModels side effect.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createChromeMock } from '../helpers/chrome-mock.js';

const { chrome, store } = createChromeMock();
vi.stubGlobal('chrome', chrome);

import { useSettingsStore } from '@/options/settings-store';
import { COMPOSER_TOOL_IDS } from '@/platform/settings';

const clearStorage = () => {
  for (const area of ['sync', 'local', 'session'] as const) {
    for (const k of Object.keys(store[area])) delete store[area][k];
  }
};

const resetStore = () => {
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
};

// Drain any persist the previous test left scheduled, then reset.
afterEach(() => {
  useSettingsStore.getState().flushPendingPersists();
});

describe('settings-store load()', () => {
  beforeEach(() => {
    clearStorage();
    resetStore();
  });

  it('applies defaults for never-saved settings (webSearch quirk)', async () => {
    await useSettingsStore.getState().load();

    const s = useSettingsStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.webSearch).toBe(true); // on by default — no HTML checked attr anymore
    expect(s.citations).toBe(true);
    expect(s.suggestQuestions).toBe(true);
    expect(s.agentMode).toBe(false);
    expect(s.ttsAutoPlay).toBe(false);
    expect(s.podcastDirect).toBe(false);
    expect(s.provider).toBe('openai');
    expect(s.composerTools).toEqual([...COMPOSER_TOOL_IDS]); // absent → all shown
    expect(s.lang).toBe('zh');
    expect(s.themeName).toBe('sujian');
    // text fields show only what the user set — no defaults leak in
    expect(s.apiKey).toBe('');
    expect(s.apiBase).toBe('');
  });

  it('shows stored values as-is (booleans can be turned off)', async () => {
    store.sync.webSearch = false;
    store.local.apiKey = 'sk-live'; // secrets live in local
    store.sync.provider = 'anthropic';
    store.sync.composerTools = ['upload'];

    await useSettingsStore.getState().load();

    const s = useSettingsStore.getState();
    expect(s.webSearch).toBe(false);
    expect(s.apiKey).toBe('sk-live');
    expect(s.provider).toBe('anthropic');
    expect(s.composerTools).toEqual(['upload']);
  });

  it('sweeps retired keys once per load (legacy save-button behavior)', async () => {
    store.sync.visionEnabled = true;
    store.sync.ocrApiKey = 'x'; // non-secret retired keys lived in sync
    store.sync.fastModelName = 'old';

    await useSettingsStore.getState().load();

    expect(store.sync.visionEnabled).toBeUndefined();
    expect(store.sync.ocrApiKey).toBeUndefined();
    expect(store.sync.fastModelName).toBeUndefined();
  });

  it('auto-refreshes the model list when a stored apiKey exists', async () => {
    store.local.apiKey = 'sk-live';
    vi.mocked(chrome.runtime.sendMessage).mockClear();

    await useSettingsStore.getState().load();
    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalled());

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fetchModels', apiKey: 'sk-live' }),
    );
  });
});

describe('settings-store immediate writes (toggles / selects)', () => {
  beforeEach(() => {
    clearStorage();
    resetStore();
    vi.mocked(chrome.runtime.sendMessage).mockClear();
  });

  it('setToggle writes on change', async () => {
    useSettingsStore.getState().setToggle('webSearch', false);
    await vi.waitFor(() => expect(store.sync.webSearch).toBe(false));
  });

  it('setProvider writes on change', async () => {
    useSettingsStore.getState().setProvider('anthropic');
    await vi.waitFor(() => expect(store.sync.provider).toBe('anthropic'));
  });

  it('setComposerTools writes on change (empty array is valid)', async () => {
    useSettingsStore.getState().setComposerTools([]);
    await vi.waitFor(() => expect(store.sync.composerTools).toEqual([]));
  });

  it('a failed write surfaces as an error status', async () => {
    const spy = vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(new Error('quota'));
    useSettingsStore.getState().setToggle('agentMode', true);
    await vi.waitFor(() =>
      expect(useSettingsStore.getState().status?.type).toBe('error'),
    );
    expect(useSettingsStore.getState().status?.message).toContain('保存设置失败');
    spy.mockRestore();
  });
});

describe('settings-store debounced text persist', () => {
  beforeEach(() => {
    clearStorage();
    resetStore();
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates state at once but persists only after the debounce', async () => {
    useSettingsStore.getState().setText('apiBase', 'https://x');

    expect(useSettingsStore.getState().apiBase).toBe('https://x'); // controlled input
    expect(store.sync.apiBase).toBeUndefined(); // …but not persisted yet

    await vi.advanceTimersByTimeAsync(500);
    expect(store.sync.apiBase).toBe('https://x');
  });

  it('trims on persist; an empty value REMOVES the key instead of storing ""', async () => {
    store.sync.modelName = 'deepseek-chat';
    useSettingsStore.getState().setText('modelName', '  ');
    await vi.advanceTimersByTimeAsync(500);
    expect(store.sync.modelName).toBeUndefined();

    useSettingsStore.getState().setText('systemPrompt', '  be terse  ');
    await vi.advanceTimersByTimeAsync(500);
    expect(store.sync.systemPrompt).toBe('be terse');
  });

  it('blur flushes the pending persist immediately', async () => {
    useSettingsStore.getState().setText('apiBase', 'https://y');
    useSettingsStore.getState().blurText('apiBase');
    expect(store.sync.apiBase).toBe('https://y');
  });

  it('secrets persist to storage.local and are cleared from sync', async () => {
    store.sync.apiKey = 'stale'; // pre-migration copy
    useSettingsStore.getState().setText('apiKey', 'sk-new');
    await vi.advanceTimersByTimeAsync(500);
    expect(store.local.apiKey).toBe('sk-new');
    expect(store.sync.apiKey).toBeUndefined();
  });

  it('a persisted apiKey bumps savedTick and refreshes models once', async () => {
    useSettingsStore.getState().setText('apiKey', 'sk-1');
    await vi.advanceTimersByTimeAsync(500);

    expect(useSettingsStore.getState().savedTick.apiKey).toBe(1);
    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalled());
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fetchModels' }),
    );
  });

  it('a cleared apiKey does NOT trigger a model refresh', async () => {
    useSettingsStore.getState().setText('apiKey', '');
    await vi.advanceTimersByTimeAsync(500);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('settings-store refreshModels', () => {
  beforeEach(() => {
    clearStorage();
    resetStore();
  });

  it('reports an error status without an apiKey', async () => {
    useSettingsStore.getState().refreshModels();
    await vi.waitFor(() => expect(useSettingsStore.getState().status?.type).toBe('error'));
    expect(useSettingsStore.getState().models).toEqual([]);
  });

  it('stores the model list and reports success', async () => {
    useSettingsStore.setState({ apiKey: 'sk-live' });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      models: ['m1', 'm2'],
    } as never);

    await useSettingsStore.getState().refreshModels();

    expect(useSettingsStore.getState().models).toEqual(['m1', 'm2']);
    expect(useSettingsStore.getState().status?.type).toBe('success');
    expect(useSettingsStore.getState().modelsLoading).toBe(false);
  });

  it('surfaces an API error message as-is', async () => {
    useSettingsStore.setState({ apiKey: 'sk-live' });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: false,
      error: 'boom',
    } as never);

    await useSettingsStore.getState().refreshModels();

    expect(useSettingsStore.getState().status).toMatchObject({ message: 'boom', type: 'error' });
  });
});
