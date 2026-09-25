/**
 * F1 — citations: a click on a [#N] chip scrolls the page to paragraph N and
 * flashes it. The paragraph text comes from the tab's extraction
 * (TabState.pageParagraphs); the content script finds it in the live page.
 */

import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { on, EVENTS } from '../events';
import { sendToContentScript } from '../../platform/messaging';
import { showToast } from '../ui/toast';
import { bindCitationClicks } from '../ui/citations';
import { paragraphTimestamp, youtubeVideoId } from '../../shared/youtube';
import { isPdfUrl } from '../../shared/pdf-text';

export function initCitations({ chatArea }: { chatArea: HTMLElement }): void {
  bindCitationClicks(chatArea);
  on(EVENTS.CITATION_CLICK, ({ index }) => { void jumpToParagraph(index); });
}

export async function jumpToParagraph(index: number): Promise<boolean> {
  const tabId = state.getActiveTabId();
  const text = tabId != null ? state.getStateForTab(tabId)?.pageParagraphs?.[index] : undefined;
  if (tabId == null || !text) {
    showToast(t('citation.unavailable'), 2500);
    return false;
  }
  const pageUrl = state.getStateForTab(tabId)?.pageUrl ?? '';
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
    // Chrome's PDF viewer can't be scrolled from outside: show the passage instead.
    showToast(t('citation.quote', { text: text.length > 160 ? text.slice(0, 160) + '…' : text }), 5000);
  } else {
    showToast(t('citation.notFound'), 2500);
  }
  return false;
}
