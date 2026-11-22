/**
 * Citations — React port of features/citations.ts: a click on a [#N] chip
 * scrolls the page to paragraph N (from TabState.pageParagraphs) and
 * flashes it; YouTube transcript paragraphs seek instead; PDFs show the
 * passage as a toast (Chrome's viewer can't be scrolled from outside).
 */
import { t } from '@/shared/i18n.js';
import { sendToContentScript } from '@/platform/messaging';
import * as core from '@/panel/state';
import { useUIStore } from '@/panel/stores/ui-store';
import { paragraphTimestamp, youtubeVideoId } from '@/shared/youtube';
import { isPdfUrl } from '@/shared/pdf-text';

export async function jumpToParagraph(index: number): Promise<boolean> {
  const tabId = core.getActiveTabId();
  const ts = tabId != null ? core.getStateForTab(tabId) : null;
  const text = ts?.pageParagraphs?.[index];
  if (tabId == null || !text) {
    useUIStore.getState().pushToast(t('citation.unavailable'));
    return false;
  }
  const pageUrl = ts?.pageUrl ?? '';
  // F3: a transcript paragraph → seek the video to its timestamp.
  const seconds = youtubeVideoId(pageUrl) ? paragraphTimestamp(text) : null;
  if (seconds !== null) {
    const res = await sendToContentScript<{ ok?: boolean }>(tabId, { action: 'seekVideo', seconds }).catch(() => null);
    if (res?.ok) return true;
  } else if (!isPdfUrl(pageUrl)) {
    try {
      const res = await sendToContentScript<{ ok?: boolean }>(tabId, { action: 'highlightParagraph', text });
      if (res?.ok) return true;
    } catch { /* page can't host the content script */ }
  }
  if (isPdfUrl(pageUrl)) {
    useUIStore.getState().pushToast(t('citation.quote', { text: text.length > 160 ? `${text.slice(0, 160)}…` : text }));
  } else {
    useUIStore.getState().pushToast(t('citation.notFound'));
  }
  return false;
}
