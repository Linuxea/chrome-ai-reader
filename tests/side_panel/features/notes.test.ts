import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../src/side_panel/state.js', () => ({ getActiveTabId: () => 3, setSelectedText: vi.fn() }));
vi.mock('../../../src/platform/messaging.js', () => ({ sendMessage: vi.fn(), sendToContentScript: vi.fn() }));
vi.mock('../../../src/shared/download.js', () => ({ downloadFile: vi.fn() }));
vi.mock('../../../src/side_panel/ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/side_panel/services/composer.js', () => ({ setDraftText: vi.fn() }));

import { initNotes, openNotes, highlightCurrentSelection, exportAll } from '../../../src/side_panel/features/notes';
import { sendMessage, sendToContentScript } from '../../../src/platform/messaging.js';
import { downloadFile } from '../../../src/shared/download.js';
import { showToast } from '../../../src/side_panel/ui/toast.js';

const H = { id: 'h1', url: 'u', pageUrl: 'https://p.example', title: 'P', exact: 'quoted words', prefix: '', suffix: '', note: 'mine', createdAt: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `
    <button id="b"></button><div id="panel" class="hidden"></div><div id="list"></div>
    <button id="back"></button><button id="exp"></button><button id="hl"></button>
    <div id="qp" class="hidden"><span id="qt"></span></div>`;
  vi.stubGlobal('chrome', { tabs: { get: vi.fn(async () => ({ id: 3, url: 'https://p.example' })) } });
  const $ = (id: string) => document.getElementById(id)!;
  initNotes({ button: $('b'), panel: $('panel'), list: $('list'), backBtn: $('back'), exportBtn: $('exp'), highlightBtn: $('hl'), quoteEls: { quoteText: $('qt'), quotePreview: $('qp') } });
});

describe('features/notes', () => {
  it('lists this page\'s highlights with their notes', async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: true, highlights: [H] });
    await openNotes();
    expect(sendMessage).toHaveBeenCalledWith({ action: 'highlights:list', pageUrl: 'https://p.example' });
    expect(document.querySelector('.note-quote')!.textContent).toBe('quoted words');
    expect((document.querySelector('.note-text') as HTMLTextAreaElement).value).toBe('mine');
    expect(document.getElementById('panel')!.classList.contains('hidden')).toBe(false);
  });

  it('deleting removes it from the store and repaints the page', async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: true, highlights: [H] }).mockResolvedValueOnce({ success: true });
    vi.mocked(sendToContentScript).mockResolvedValue({ ok: true });
    await openNotes();
    const del = [...document.querySelectorAll<HTMLButtonElement>('.note-actions button')].find((b) => b.textContent === '[notes.delete]')!;
    del.click();
    await vi.waitFor(() => expect(sendToContentScript).toHaveBeenCalledWith(3, { action: 'refreshHighlights' }));
    expect(sendMessage).toHaveBeenCalledWith({ action: 'highlights:delete', id: 'h1' });
  });

  it('highlightCurrentSelection asks the page and explains an empty selection', async () => {
    vi.mocked(sendToContentScript).mockResolvedValueOnce({ ok: false });
    expect(await highlightCurrentSelection()).toBe(false);
    expect(showToast).toHaveBeenCalledWith('[notes.noSelection]', 2500);
  });

  it('exports every highlight as Markdown', async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: true, highlights: [H] });
    await exportAll();
    const [md, name] = vi.mocked(downloadFile).mock.calls[0];
    expect(md).toContain('> quoted words');
    expect(name).toMatch(/_notes_\d{4}-\d{2}-\d{2}\.md$/);
  });
});
