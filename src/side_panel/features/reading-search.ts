/**
 * F5 — reading library search: semantic search over every page read with
 * the extension (the related-reading records), from a search box in the
 * related-reading panel header. The worker embeds the query and ranks the
 * records (pageRecords:search); a result opens the page. In agent mode the
 * model can run the same search itself (search_reading_history) to answer
 * questions across the library.
 */

import { t } from '../../shared/i18n.js';
import type { PageRelation } from '../../shared/types';
import type { PageRecordsFindRelatedResponse } from '../../shared/protocol';
import { sendMessage } from '../../platform/messaging';

let _results: HTMLElement | null = null;

export function initReadingSearch(panel: HTMLElement | null): void {
  const header = panel?.querySelector('.related-header');
  if (!panel || !header) return;

  const form = document.createElement('form');
  form.className = 'reading-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'reading-search-input';
  input.placeholder = t('library.searchPlaceholder');
  input.setAttribute('aria-label', t('library.searchPlaceholder'));
  form.appendChild(input);
  header.insertAdjacentElement('afterend', form);

  _results = document.createElement('div');
  _results.className = 'reading-search-results hidden';
  form.insertAdjacentElement('afterend', _results);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void search(input.value.trim());
  });
  input.addEventListener('search', () => { if (!input.value) hideResults(); });
}

function hideResults(): void {
  _results?.classList.add('hidden');
  if (_results) _results.textContent = '';
}

function note(text: string): void {
  if (!_results) return;
  _results.textContent = '';
  const div = document.createElement('div');
  div.className = 'reading-search-note';
  div.textContent = text;
  _results.appendChild(div);
  _results.classList.remove('hidden');
}

export async function search(query: string): Promise<void> {
  if (!_results) return;
  if (!query) { hideResults(); return; }
  note(t('library.searching'));
  let res: PageRecordsFindRelatedResponse;
  try {
    res = await sendMessage({ action: 'pageRecords:search', query, limit: 8 }) as PageRecordsFindRelatedResponse;
  } catch (e) {
    note(t('library.failed', { error: (e as Error).message }));
    return;
  }
  if (!res?.success) {
    note(res?.errorKey === 'error.embeddingNotConfigured' ? t('related.notConfigured') : t('library.failed', { error: res?.error ?? '' }));
    return;
  }
  renderResults(res.relations ?? []);
}

function renderResults(relations: PageRelation[]): void {
  if (!_results) return;
  if (!relations.length) { note(t('library.noResults')); return; }
  _results.textContent = '';
  for (const r of relations) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'reading-search-item';
    const title = document.createElement('div');
    title.className = 'related-item-title';
    title.textContent = r.record.title || r.record.url;
    const meta = document.createElement('div');
    meta.className = 'related-item-meta';
    meta.textContent = `${Math.round(r.similarity * 100)}% · ${new URL(r.record.url).hostname}`;
    const excerpt = document.createElement('div');
    excerpt.className = 'related-item-excerpt';
    excerpt.textContent = (r.record.excerpt || '').slice(0, 120);
    item.append(title, meta, excerpt);
    item.addEventListener('click', () => { void chrome.tabs.create({ url: r.record.url }); });
    _results.appendChild(item);
  }
  _results.classList.remove('hidden');
}
