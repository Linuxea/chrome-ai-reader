import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string, p?: Record<string, string>) => `[${k}]${p?.error ?? ''}` }));
vi.mock('../../../src/platform/messaging.js', () => ({ sendMessage: vi.fn() }));

import { initReadingSearch, search } from '../../../src/side_panel/features/reading-search';
import { sendMessage } from '../../../src/platform/messaging.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="p"><div class="related-header"></div><div class="related-list"></div></div>';
  initReadingSearch(document.getElementById('p'));
  vi.stubGlobal('chrome', { tabs: { create: vi.fn() } });
});

describe('features/reading-search', () => {
  it('adds a search box and renders ranked results that open the page', async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: true, relations: [
      { record: { url: 'https://a.example/x', title: 'Alpha', excerpt: 'about alpha', normalizedUrl: '', id: '', embedding: [], timestamp: 0 }, similarity: 0.81 },
    ] });
    await search('alpha');
    expect(sendMessage).toHaveBeenCalledWith({ action: 'pageRecords:search', query: 'alpha', limit: 8 });
    const item = document.querySelector<HTMLElement>('.reading-search-item')!;
    expect(item.textContent).toContain('Alpha');
    expect(item.textContent).toContain('81%');
    item.click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.example/x' });
  });

  it('explains a missing embedding configuration', async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: false, errorKey: 'error.embeddingNotConfigured' });
    await search('q');
    expect(document.querySelector('.reading-search-note')!.textContent).toBe('[related.notConfigured]');
  });
});
