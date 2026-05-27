import { t } from '../../shared/i18n.js';
import * as state from '../state';

export interface ExtractResult {
  textContent: string;
  excerpt: string;
  title: string;
}

export async function extractPageContent(expectTabId?: number | null): Promise<ExtractResult> {
  const tabId = expectTabId || state.getActiveTabId();
  if (!tabId) throw new Error(t('error.noTab'));

  const response = await chrome.tabs.sendMessage(tabId, { action: 'extract' }) as { success?: boolean; error?: string; data?: ExtractResult };
  if (!response?.success) {
    throw new Error(response?.error || t('error.extractFailed'));
  }

  const tabState = state.getStateForTab(tabId);
  if (tabState && response.data) {
    tabState.pageContent = response.data.textContent;
    tabState.pageExcerpt = response.data.excerpt;
    tabState.pageTitle = response.data.title;
    state.persistForTab(tabId);
  }

  return response.data!;
}
