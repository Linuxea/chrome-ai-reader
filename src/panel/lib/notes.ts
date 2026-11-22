/**
 * Notes — React port of features/notes.ts: list the current page's
 * highlights (from the worker's IndexedDB), edit notes, ask, delete, and
 * export everything as Markdown. Highlighting the current selection asks
 * the content script and clears the quote bar.
 */
import { t } from '@/shared/i18n.js';
import { sendMessage, sendToContentScript } from '@/platform/messaging';
import { downloadFile } from '@/shared/download';
import { highlightsToMarkdown, type Highlight } from '@/shared/highlights';
import * as core from '@/panel/state';
import { useUIStore } from '@/panel/stores/ui-store';
import { useTabsStore } from '@/panel/stores/tabs-store';

export async function listNotes(): Promise<Highlight[]> {
  const tabId = core.getActiveTabId();
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => undefined) : undefined;
  const res = tab?.url
    ? (await sendMessage({ action: 'highlights:list', pageUrl: tab.url })) as { success?: boolean; highlights?: Highlight[] }
    : undefined;
  return res?.success ? res.highlights ?? [] : [];
}

/** Highlight what is selected in the page; returns true on success. */
export async function highlightCurrentSelection(): Promise<boolean> {
  const tabId = core.getActiveTabId();
  if (tabId == null) return false;
  try {
    const res = await sendToContentScript<{ ok?: boolean }>(tabId, { action: 'highlightSelection', note: '' });
    if (!res?.ok) {
      useUIStore.getState().pushToast(t('notes.noSelection'));
      return false;
    }
  } catch {
    useUIStore.getState().pushToast(t('error.pageUnsupported'), 'error');
    return false;
  }
  useTabsStore.getState().setSelectedText('');
  return true;
}

export async function updateNote(id: string, note: string): Promise<void> {
  await sendMessage({ action: 'highlights:update', id, note });
}

export async function deleteNote(id: string): Promise<void> {
  await sendMessage({ action: 'highlights:delete', id });
  const tabId = core.getActiveTabId();
  if (tabId != null) sendToContentScript(tabId, { action: 'refreshHighlights' }).catch(() => { /* page gone */ });
}

export async function exportAllNotes(): Promise<void> {
  const res = (await sendMessage({ action: 'highlights:all' })) as { success?: boolean; highlights?: Highlight[] };
  const items = res?.success ? res.highlights ?? [] : [];
  if (!items.length) {
    useUIStore.getState().pushToast(t('notes.empty'));
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(highlightsToMarkdown(items, t('notes.exportHeading')), `${t('app.fullName')}_notes_${date}.md`, 'text/markdown;charset=utf-8');
}
