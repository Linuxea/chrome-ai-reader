import { t } from '../../shared/i18n.js';
import type { Result } from '../../shared/types';
import { ok, err } from '../../shared/result.js';
import * as state from '../state';
import { requestEmbedding } from '../features/related-pages';

export interface ExtractResult {
  textContent: string;
  excerpt: string;
  title: string;
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

  // Trigger embedding in background after a delay (avoid rapid tab switches wasting calls)
  if (response.data) {
    // Capture URL now to avoid race condition if user switches tabs during the delay
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url;
    setTimeout(() => {
      if (url) requestEmbedding(response.data!.excerpt, url, response.data!.title);
    }, 3000);
  }

  return ok(response.data!);
}
