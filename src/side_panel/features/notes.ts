/**
 * F6 — highlights & notes in the panel. Highlights are made in the page
 * (🖍 on the quote bar, or the context menu), stored by the worker in
 * IndexedDB, and repainted whenever the page loads. This view lists the
 * current page's highlights: edit the note, ask about one, delete it; and
 * exports every note as Markdown.
 */

import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { sendMessage, sendToContentScript } from '../../platform/messaging';
import { downloadFile } from '../../shared/download';
import { highlightsToMarkdown, type Highlight } from '../../shared/highlights';
import { showToast } from '../ui/toast';
import { updateQuotePreview, type QuotePreviewEls } from '../ui/quote-preview';
import { setDraftText } from '../services/composer';

interface NotesDeps {
  button: HTMLElement;
  panel: HTMLElement;
  list: HTMLElement;
  backBtn: HTMLElement;
  exportBtn: HTMLElement;
  highlightBtn: HTMLElement | null;
  quoteEls: QuotePreviewEls;
}

let _deps: NotesDeps;

export function initNotes(deps: NotesDeps): void {
  _deps = deps;
  deps.button.addEventListener('click', () => { void openNotes(); });
  deps.backBtn.addEventListener('click', () => deps.panel.classList.add('hidden'));
  deps.exportBtn.addEventListener('click', () => { void exportAll(); });
  deps.highlightBtn?.addEventListener('click', () => { void highlightCurrentSelection(); });
}

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabId = state.getActiveTabId();
  return tabId != null ? chrome.tabs.get(tabId).catch(() => undefined) : undefined;
}

/** Highlight what is selected in the page, then show the notes view. */
export async function highlightCurrentSelection(): Promise<boolean> {
  const tabId = state.getActiveTabId();
  if (tabId == null) return false;
  try {
    const res = await sendToContentScript<{ ok?: boolean }>(tabId, { action: 'highlightSelection', note: '' });
    if (!res?.ok) { showToast(t('notes.noSelection'), 2500); return false; }
  } catch {
    showToast(t('error.pageUnsupported'), 2500);
    return false;
  }
  updateQuotePreview(_deps.quoteEls, '');
  await openNotes();
  return true;
}

export async function openNotes(): Promise<void> {
  _deps.panel.classList.remove('hidden');
  const tab = await currentTab();
  const res = tab?.url
    ? await sendMessage({ action: 'highlights:list', pageUrl: tab.url }) as { success?: boolean; highlights?: Highlight[] }
    : undefined;
  renderList(res?.success ? res.highlights ?? [] : []);
}

function renderList(items: Highlight[]): void {
  const list = _deps.list;
  list.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = t('notes.empty');
    list.appendChild(empty);
    return;
  }
  for (const h of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    const item = document.createElement('div');
    item.className = 'note-item';

    const quote = document.createElement('blockquote');
    quote.className = 'note-quote';
    quote.textContent = h.exact;

    const note = document.createElement('textarea');
    note.className = 'note-text';
    note.rows = 2;
    note.placeholder = t('notes.notePlaceholder');
    note.value = h.note;
    note.addEventListener('change', () => {
      void sendMessage({ action: 'highlights:update', id: h.id, note: note.value });
    });

    const actions = document.createElement('div');
    actions.className = 'note-actions';
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.textContent = t('notes.ask');
    ask.addEventListener('click', () => {
      updateQuotePreview(_deps.quoteEls, h.exact);
      setDraftText(h.note ? h.note : '', { focus: true });
      _deps.panel.classList.add('hidden');
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = t('notes.delete');
    del.addEventListener('click', async () => {
      await sendMessage({ action: 'highlights:delete', id: h.id });
      item.remove();
      const tabId = state.getActiveTabId();
      if (tabId != null) sendToContentScript(tabId, { action: 'refreshHighlights' }).catch(() => { /* page gone */ });
      if (!list.querySelector('.note-item')) renderList([]);
    });
    actions.append(ask, del);
    item.append(quote, note, actions);
    list.appendChild(item);
  }
}

export async function exportAll(): Promise<void> {
  const res = await sendMessage({ action: 'highlights:all' }) as { success?: boolean; highlights?: Highlight[] };
  const items = res?.success ? res.highlights ?? [] : [];
  if (!items.length) { showToast(t('notes.empty'), 2500); return; }
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(highlightsToMarkdown(items, t('notes.exportHeading')), `${t('app.fullName')}_notes_${date}.md`, 'text/markdown;charset=utf-8');
}
