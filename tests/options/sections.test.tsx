/**
 * Phase-2 sections — RTL coverage: appearance (theme/language live
 * switch), TTS fields + cache, composer-tools ordering, quick-command
 * CRUD validation, usage table, and the import round trip.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createChromeMock } from '../helpers/chrome-mock.js';

const { chrome, store } = createChromeMock();
vi.stubGlobal('chrome', chrome);

const { downloadFile } = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('@/shared/download', () => ({ downloadFile }));

const { estimateTtsCacheBytesMock, clearTtsCacheMock } = vi.hoisted(() => ({
  estimateTtsCacheBytesMock: vi.fn(),
  clearTtsCacheMock: vi.fn(),
}));
vi.mock('@/shared/tts-cache', () => ({
  estimateTtsCacheBytes: estimateTtsCacheBytesMock,
  clearTtsCache: clearTtsCacheMock,
}));

import { setLanguage, t } from '@/shared/i18n.js';
import { useSettingsStore } from '@/options/settings-store';
import { AppearanceSection } from '@/options/sections/AppearanceSection';
import { TtsSection } from '@/options/sections/TtsSection';
import { SuggestSection } from '@/options/sections/SuggestSection';
import { ComposerToolsSection } from '@/options/sections/ComposerToolsSection';
import { QuickCommandsSection } from '@/options/sections/QuickCommandsSection';
import { UsageSection } from '@/options/sections/UsageSection';
import { DataSection } from '@/options/sections/DataSection';

const clearStorage = () => {
  for (const area of ['sync', 'local', 'session'] as const) {
    for (const k of Object.keys(store[area])) delete store[area][k];
  }
};

beforeEach(() => {
  clearStorage();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  setLanguage('zh');
  vi.mocked(chrome.runtime.sendMessage).mockReset();
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true, models: ['m1'] } as never);
  downloadFile.mockClear();
  document.documentElement.removeAttribute('data-theme-name');
});

describe('AppearanceSection', () => {
  it('selects a theme card: writes storage + applies the html attribute', async () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByText(t('settings.theme.ocean')));

    await waitFor(() => expect(store.sync.themeName).toBe('ocean'));
    expect(document.documentElement.getAttribute('data-theme-name')).toBe('ocean');
    expect(useSettingsStore.getState().themeName).toBe('ocean');
  });

  it('switching the UI language persists it and re-renders the labels', async () => {
    render(<AppearanceSection />);
    const zhTitle = t('settings.language');
    expect(screen.getByText(zhTitle, { exact: false })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t('settings.language'), { exact: false }), {
      target: { value: 'en' },
    });

    await waitFor(() => expect(store.sync.language).toBe('en'));
    // the store's lang bump re-renders the section → English labels
    await waitFor(() => expect(screen.queryByText(zhTitle, { exact: false })).not.toBeInTheDocument());
    expect(useSettingsStore.getState().lang).toBe('en');
    setLanguage('zh'); // restore for other tests in this file
  });
});

describe('TtsSection', () => {
  it('persists credentials on blur (empty → remove)', async () => {
    store.sync.ttsAppId = 'old-id';
    render(<TtsSection />);

    const appId = screen.getByLabelText(t('settings.tts.appId'), { exact: false });
    fireEvent.change(appId, { target: { value: 'app-1' } });
    fireEvent.blur(appId);
    await waitFor(() => expect(store.sync.ttsAppId).toBe('app-1'));

    fireEvent.change(appId, { target: { value: '' } });
    fireEvent.blur(appId);
    await waitFor(() => expect(store.sync.ttsAppId).toBeUndefined());
  });

  it('toggles write immediately', async () => {
    render(<TtsSection />);
    const row = screen.getByText(t('settings.podcast.direct')).closest('.toggle-row')!;
    fireEvent.click(row.querySelector('input[type="checkbox"]')!);
    await waitFor(() => expect(store.sync.podcastDirect).toBe(true));
  });

  it('shows the cache size and clears the cache', async () => {
    estimateTtsCacheBytesMock.mockResolvedValue(1024 * 1024);
    clearTtsCacheMock.mockResolvedValue(undefined);

    render(<TtsSection />);
    await waitFor(() => expect(screen.getByText('1.0 MB')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: t('settings.tts.cache.clear') }));
    await waitFor(() =>
      expect(useSettingsStore.getState().status?.type).toBe('success'),
    );
    expect(clearTtsCacheMock).toHaveBeenCalled();
  });
});

describe('SuggestSection', () => {
  it('toggles suggest questions', async () => {
    render(<SuggestSection />);
    const row = screen.getByText(t('settings.suggest.toggle')).closest('.toggle-row')!;
    fireEvent.click(row.querySelector('input[type="checkbox"]')!);
    await waitFor(() => expect(store.sync.suggestQuestions).toBe(false));
  });
});

describe('ComposerToolsSection', () => {
  it('defaults to all tools shown; unchecking keeps COMPOSER_TOOL_IDS order', async () => {
    render(<ComposerToolsSection />);

    const row = screen.getByText(t('sidebar.visionCaptureFull')).closest('.toggle-row')!;
    fireEvent.click(row.querySelector('input[type="checkbox"]')!); // uncheck captureFull

    await waitFor(() =>
      expect(useSettingsStore.getState().composerTools).toEqual(['capture', 'upload', 'tabs']),
    );
    await waitFor(() => expect(store.sync.composerTools).toEqual(['capture', 'upload', 'tabs']));

    // re-check: order follows the tool table, not click order
    fireEvent.click(row.querySelector('input[type="checkbox"]')!);
    await waitFor(() =>
      expect(useSettingsStore.getState().composerTools).toEqual([
        'capture', 'captureFull', 'upload', 'tabs',
      ]),
    );
  });

  it('allows emptying the bar completely (everything in the "+" menu)', async () => {
    render(<ComposerToolsSection />);
    for (const label of [
      t('sidebar.visionCapture'),
      t('sidebar.visionCaptureFull'),
      t('sidebar.uploadImage'),
      t('sidebar.attachTabs'),
    ]) {
      fireEvent.click(screen.getByText(label).closest('.toggle-row')!.querySelector('input')!);
    }
    await waitFor(() => expect(store.sync.composerTools).toEqual([]));
  });
});

describe('QuickCommandsSection', () => {
  it('starts empty, creates a valid command, blocks invalid ones', async () => {
    render(<QuickCommandsSection />);
    expect(screen.getByText(t('settings.commands.empty'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.add') }));
    const name = screen.getByPlaceholderText(t('settings.commands.name.ph'));
    const prompt = screen.getByPlaceholderText(t('settings.commands.prompt.ph'));

    // invalid: name with a space
    fireEvent.change(name, { target: { value: 'sum marize' } });
    fireEvent.change(prompt, { target: { value: 'Summarize the page' } });
    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.save') }));
    expect(useSettingsStore.getState().status?.message).toBe(t('status.commandInvalid'));

    // valid
    fireEvent.change(name, { target: { value: 'summary' } });
    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.save') }));
    await waitFor(() => expect(store.local.quickCommands).toEqual([
      { name: 'summary', prompt: 'Summarize the page' },
    ]));
    expect(screen.getByText('/summary')).toBeInTheDocument();
  });

  it('blocks duplicate names and deletes commands', async () => {
    store.local.quickCommands = [{ name: 'a', prompt: 'p1' }];
    render(<QuickCommandsSection />);

    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.add') }));
    fireEvent.change(screen.getByPlaceholderText(t('settings.commands.name.ph')), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByPlaceholderText(t('settings.commands.prompt.ph')), {
      target: { value: 'p2' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.save') }));
    expect(useSettingsStore.getState().status?.message).toBe(t('status.commandDuplicate'));

    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.delete') }));
    await waitFor(() => expect(store.local.quickCommands).toBeUndefined());
    expect(screen.getByText(t('settings.commands.empty'))).toBeInTheDocument();
  });

  it('edits an existing command', async () => {
    store.local.quickCommands = [{ name: 'a', prompt: 'p1' }];
    render(<QuickCommandsSection />);

    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.edit') }));
    fireEvent.change(screen.getByPlaceholderText(t('settings.commands.prompt.ph')), {
      target: { value: 'updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('settings.commands.save') }));

    await waitFor(() =>
      expect(store.local.quickCommands).toEqual([{ name: 'a', prompt: 'updated' }]),
    );
  });

  it('follows external rewrites of the list (import path)', async () => {
    render(<QuickCommandsSection />);
    expect(screen.getByText(t('settings.commands.empty'))).toBeInTheDocument();

    chrome.storage.local.set({
      quickCommands: [{ name: 'imported', prompt: 'p' }],
    });

    await waitFor(() => expect(screen.getByText('/imported')).toBeInTheDocument());
  });
});

describe('UsageSection', () => {
  it('renders per-model rows and the total', async () => {
    const { USAGE_KEY, dayKey } = await import('@/shared/usage-stats');
    const today = dayKey();
    store.local[USAGE_KEY] = {
      [today]: {
        'model-a': { requests: 2, inputTokens: 10, outputTokens: 5 },
        'model-b': { requests: 1, inputTokens: 4, outputTokens: 6 },
      },
    };
    render(<UsageSection />);

    await waitFor(() => expect(screen.getByText('model-a')).toBeInTheDocument());
    expect(screen.getByText('model-b')).toBeInTheDocument();
    expect(screen.getByText(t('settings.usage.total'))).toBeInTheDocument();
  });

  it('shows the empty state and clears statistics after confirm', async () => {
    const { USAGE_KEY, dayKey } = await import('@/shared/usage-stats');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<UsageSection />);

    await waitFor(() => expect(screen.getByText(t('settings.usage.empty'))).toBeInTheDocument());
    store.local[USAGE_KEY] = {
      [dayKey()]: { m: { requests: 1, inputTokens: 1, outputTokens: 1 } },
    };
    fireEvent.change(screen.getByDisplayValue(t('settings.usage.week')), { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: t('settings.usage.clear') }));
    await waitFor(() => expect(store.local[USAGE_KEY]).toBeUndefined());
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('DataSection', () => {
  it('exports the current settings (secrets redacted by default)', async () => {
    store.sync.apiBase = 'https://x';
    store.local.apiKey = 'sk-live';
    render(<DataSection />);

    fireEvent.click(screen.getByRole('button', { name: t('settings.data.export') }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());

    const payload = JSON.parse(downloadFile.mock.calls[0][0] as string);
    expect(payload.version).toBe(1);
    expect(payload.apiBase).toBe('https://x');
    expect(payload.apiKey).toBeUndefined(); // redacted
  });

  it('imports a backup: applies values, replaces commands, keeps absent secrets', async () => {
    store.local.apiKey = 'sk-keep';
    store.sync.apiBase = 'https://old';
    store.sync.quickCommandsBackup = undefined;
    render(<DataSection />);

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          apiKey: 'sk-new',
          webSearch: false,
          quickCommands: [{ name: 'sum', prompt: 'Summarize' }],
        }),
      ],
      'backup.json',
      { type: 'application/json' },
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(useSettingsStore.getState().status?.type).toBe('success'));
    expect(store.local.apiKey).toBe('sk-new');
    expect(store.sync.apiBase).toBeUndefined(); // absent non-secret → removed
    expect(store.sync.webSearch).toBe(false);
    expect(store.local.quickCommands).toEqual([{ name: 'sum', prompt: 'Summarize' }]);
    // the visible form follows storage
    expect(useSettingsStore.getState().webSearch).toBe(false);
    expect(useSettingsStore.getState().apiKey).toBe('sk-new');
  });

  it('rejects files without a version marker', async () => {
    render(<DataSection />);
    const file = new File([JSON.stringify({ apiKey: 'x' })], 'bad.json', {
      type: 'application/json',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(useSettingsStore.getState().status?.message).toBe(t('status.invalidFile')),
    );
  });
});
