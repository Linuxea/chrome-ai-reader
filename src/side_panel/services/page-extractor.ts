import { t } from '../../shared/i18n.js';
import type { Result } from '../../shared/types';
import { ok, err } from '../../shared/result.js';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import { showExtractingToast } from '../ui/toast';

export interface ExtractResult {
  textContent: string;
  excerpt: string;
  title: string;
}

/**
 * Single entry point for "make sure this tab's page content has been
 * extracted at least once". Every feature (chat, podcast, quick actions)
 * calls this instead of calling extractPageContent directly, so the
 * "extract once, then reuse the cache" rule lives in one place.
 *
 * - If pageContent is already cached for the active/expected tab → no-op (ok).
 * - Otherwise → show a brief toast, extract, return the result.
 *
 * The `|| conversationHistory.length` re-extraction that used to live in
 * message-sender is gone: history state is irrelevant — only the pageContent
 * cache decides whether to extract.
 */
export async function ensurePageContent(expectTabId?: number | null): Promise<Result<ExtractResult | null>> {
  const tabId = expectTabId || state.getActiveTabId();
  const tabState = tabId ? state.getStateForTab(tabId) : null;
  if (tabState?.pageContent) {
    return ok(null);
  }
  showExtractingToast();
  return extractPageContent(expectTabId);
}

/**
 * Extract page content via Chrome messaging. Returns Result instead of throwing,
 * since extraction failure is an expected scenario (no tab, content script not loaded, etc.).
 */
export async function extractPageContent(expectTabId?: number | null): Promise<Result<ExtractResult>> {
  const tabId = expectTabId || state.getActiveTabId();
  if (!tabId) return err(new Error(t('error.noTab')));

  const response = await chrome.tabs.sendMessage(tabId, { action: 'extract' }) as { success?: boolean; error?: string; data?: ExtractResult };
  if (!response?.success) {
    return err(new Error(response?.error || t('error.extractFailed')));
  }

  const tabState = state.getStateForTab(tabId);
  if (tabState && response.data) {
    tabState.pageContent = response.data.textContent;
    tabState.pageExcerpt = response.data.excerpt;
    tabState.pageTitle = response.data.title;
    state.persistForTab(tabId);
  }

  // Notify subscribers (e.g. related-pages embedding) via the event bus instead
  // of importing the feature layer upward. Trigger after a short delay to let
  // the page settle and avoid wasting an embedding call when the user is just
  // tab-skimming. Was 3000ms; lowered to 1500ms in the 2026-06 refactor so the
  // auto-refresh on the related-reading panel shows results noticeably faster.
  if (response.data) {
    const excerpt = response.data.excerpt;
    const title = response.data.title;
    // Capture URL now to avoid race condition if user switches tabs during the delay
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url;
    setTimeout(() => {
      if (url) emit(EVENTS.PAGE_EXTRACTED, { excerpt, url, title, content: response.data!.textContent, tabId });
    }, 1500);
  }

  return ok(response.data!);
}
