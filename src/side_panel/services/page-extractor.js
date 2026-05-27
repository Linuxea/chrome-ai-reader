// services/page-extractor.js — 页面内容提取（从 content script 获取页面文本）

import { t } from '../../shared/i18n.js';
import * as state from '../state.js';

// expectTabId 可选 —— 异步链中传入发起请求时的 tabId，
// 确保提取结果写入正确的 tab state，而非被切 tab 后的 _activeState 污染。
export async function extractPageContent(expectTabId) {
  const tabId = expectTabId || state.getActiveTabId();
  if (!tabId) throw new Error(t('error.noTab'));

  const response = await chrome.tabs.sendMessage(tabId, { action: 'extract' });
  if (!response?.success) {
    throw new Error(response?.error || t('error.extractFailed'));
  }

  const tabState = state.getStateForTab(tabId);
  if (tabState) {
    tabState.pageContent = response.data.textContent;
    tabState.pageExcerpt = response.data.excerpt;
    tabState.pageTitle = response.data.title;
    state.persistForTab(tabId);
  }

  return response.data;
}
