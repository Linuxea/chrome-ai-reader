import { t } from '../../shared/i18n.js';
import type { Result } from '../../shared/types';
import { ok, err } from '../../shared/result.js';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import { showExtractingToast } from '../ui/toast';
import { sendToContentScript } from '../../platform/messaging';
import { splitParagraphs } from '../../shared/context-builder';
import { isPdfUrl } from '../../shared/pdf-text';
import { extractPdf, servesPdf } from './pdf-extractor';

export interface ExtractResult {
  textContent: string;
  excerpt: string;
  title: string;
  paragraphs?: string[];
  /** 'video' = YouTube transcript, 'pdf' = PDF text layer (F3). */
  kind?: 'article' | 'video' | 'pdf';
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
 * Read a tab's content: PDFs via pdf.js in the panel (Chrome's PDF viewer
 * cannot host a content script), everything else via the content script. A
 * page that refuses a content script gets one more chance as a PDF served
 * from a URL without `.pdf` (checked by content-type).
 */
async function readTab(tabId: number): Promise<Result<{ data: ExtractResult; url: string }>> {
  // Capture the URL now — it keys the cache (a later navigation invalidates
  // it) and the related-pages record, and avoids a race if the user switches
  // tabs meanwhile.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url ?? '';
  const viaPdf = async (): Promise<Result<{ data: ExtractResult; url: string }>> => {
    const pdf = await extractPdf(url);
    return pdf.ok ? ok({ data: { ...pdf.value, kind: 'pdf' }, url }) : err(pdf.error);
  };
  if (isPdfUrl(url)) return viaPdf();

  let response: { success?: boolean; error?: string; data?: ExtractResult } | undefined;
  try {
    response = await sendToContentScript(tabId, { action: 'extract' });
  } catch {
    // Browser-internal pages (chrome://, the Web Store, …) cannot host a
    // content script; show that instead of Chrome's raw "Receiving end does
    // not exist".
    if (await servesPdf(url)) return viaPdf();
    return err(new Error(t('error.pageUnsupported')));
  }
  if (!response?.success || !response.data) {
    return err(new Error(response?.error || t('error.extractFailed')));
  }
  return ok({ data: response.data, url });
}

/**
 * Extract page content. Returns Result instead of throwing, since extraction
 * failure is an expected scenario (no tab, content script not loaded, etc.).
 */
export async function extractPageContent(expectTabId?: number | null): Promise<Result<ExtractResult>> {
  const tabId = expectTabId || state.getActiveTabId();
  if (!tabId) return err(new Error(t('error.noTab')));

  const read = await readTab(tabId);
  if (!read.ok) return err(read.error);
  const { data, url } = read.value;

  const tabState = state.getStateForTab(tabId);
  if (tabState) {
    tabState.pageContent = data.textContent;
    tabState.pageExcerpt = data.excerpt;
    tabState.pageTitle = data.title;
    tabState.pageUrl = url;
    tabState.pageParagraphs = data.paragraphs?.length ? data.paragraphs : splitParagraphs(data.textContent);
    state.persistForTab(tabId);
  }

  // Notify subscribers (e.g. related-pages embedding) via the event bus instead
  // of importing the feature layer upward. Trigger after a short delay to let
  // the page settle and avoid wasting an embedding call when the user is just
  // tab-skimming.
  if (url) {
    const { excerpt, title, textContent } = data;
    setTimeout(() => {
      emit(EVENTS.PAGE_EXTRACTED, { excerpt, url, title, content: textContent });
    }, 1500);
  }

  return ok(data);
}

/** Characters of another tab's text kept for multi-tab context / agent reads. */
export const OTHER_TAB_CHARS = 20_000;

/**
 * Read another tab's article without touching any tab's cache (multi-tab
 * questions, the agent's read_tab). Long pages are truncated.
 */
export async function extractTabContent(tabId: number): Promise<Result<ExtractResult & { url: string }>> {
  const read = await readTab(tabId);
  if (!read.ok) return err(read.error);
  const { data, url } = read.value;
  const text = data.textContent || '';
  return ok({
    ...data,
    textContent: text.length > OTHER_TAB_CHARS ? text.slice(0, OTHER_TAB_CHARS) + '\n' + t('ai.truncated') : text,
    url,
  });
}
