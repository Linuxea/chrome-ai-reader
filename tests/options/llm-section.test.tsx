/**
 * LlmSection — the core form: provider-following placeholders, the
 * non-blocking sk- warning, debounced persist on blur, immediate toggle
 * writes, and the model refresh round trip.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createChromeMock } from '../helpers/chrome-mock.js';

const { chrome, store } = createChromeMock();
vi.stubGlobal('chrome', chrome);

import { LlmSection } from '@/options/sections/LlmSection';
import { useSettingsStore } from '@/options/settings-store';
import { t } from '@/shared/i18n.js';

const clearStorage = () => {
  for (const area of ['sync', 'local', 'session'] as const) {
    for (const k of Object.keys(store[area])) delete store[area][k];
  }
};

const input = (label: string): HTMLInputElement =>
  screen.getByLabelText(label, { exact: false }) as HTMLInputElement;

beforeEach(() => {
  clearStorage();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  vi.mocked(chrome.runtime.sendMessage).mockClear();
});

describe('LlmSection', () => {
  it('renders the section with its fields', () => {
    render(<LlmSection />);
    expect(screen.getByText(t('settings.llm'))).toBeInTheDocument();
    expect(input(t('settings.llm.apiKey'))).toBeInTheDocument();
    expect(input(t('settings.llm.apiBase'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.llm.webSearch'))).toBeInTheDocument();
  });

  it('typing updates the field; blur flushes the persist', async () => {
    render(<LlmSection />);
    const apiKey = input(t('settings.llm.apiKey'));

    fireEvent.change(apiKey, { target: { value: 'sk-abc' } });
    expect(apiKey).toHaveValue('sk-abc');
    expect(useSettingsStore.getState().apiKey).toBe('sk-abc');

    fireEvent.blur(apiKey);
    await vi.waitFor(() => expect(store.local.apiKey).toBe('sk-abc')); // secret → local
  });

  it('shows the non-blocking sk- warning only when the heuristic fires', () => {
    render(<LlmSection />);
    const apiKey = input(t('settings.llm.apiKey'));
    const apiBase = input(t('settings.llm.apiBase'));

    fireEvent.change(apiKey, { target: { value: 'abc123' } });
    expect(screen.getByText(t('error.apiKeyHint'))).toBeInTheDocument();

    // a custom apiBase means non-sk keys are fine (Ollama & friends)
    fireEvent.change(apiBase, { target: { value: 'http://localhost:11434' } });
    expect(screen.queryByText(t('error.apiKeyHint'))).not.toBeInTheDocument();

    // and so does an sk- key on the default base
    fireEvent.change(apiBase, { target: { value: '' } });
    fireEvent.change(apiKey, { target: { value: 'sk-123' } });
    expect(screen.queryByText(t('error.apiKeyHint'))).not.toBeInTheDocument();
  });

  it('provider switch rewrites the placeholders and writes immediately', async () => {
    render(<LlmSection />);
    const provider = screen.getByLabelText(t('settings.llm.provider'), { exact: false });
    const apiBase = input(t('settings.llm.apiBase'));

    expect(apiBase).toHaveAttribute('placeholder', 'https://api.deepseek.com');

    fireEvent.change(provider, { target: { value: 'anthropic' } });
    expect(apiBase).toHaveAttribute('placeholder', 'https://api.anthropic.com');
    expect(input(t('settings.llm.apiKey'))).toHaveAttribute('placeholder', 'sk-ant-...');
    await vi.waitFor(() => expect(store.sync.provider).toBe('anthropic'));
  });

  it('toggling web search writes immediately', async () => {
    render(<LlmSection />);
    const row = screen.getByText(t('settings.llm.webSearch')).closest('.toggle-row')!;
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true); // on by default

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    await vi.waitFor(() => expect(store.sync.webSearch).toBe(false));
  });

  it('refresh models fills the datalist and toasts success', async () => {
    useSettingsStore.setState({ apiKey: 'sk-live' });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      models: ['deepseek-flash', 'deepseek-reasoner'],
    } as never);
    render(<LlmSection />);

    fireEvent.click(screen.getByRole('button', { name: t('settings.llm.refreshModels') }));

    await vi.waitFor(() => {
      const options = document.querySelectorAll('#model-list option');
      expect(options).toHaveLength(2);
    });
    expect(useSettingsStore.getState().status?.type).toBe('success');
  });
});
