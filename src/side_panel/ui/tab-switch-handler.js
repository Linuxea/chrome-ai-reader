// ui/tab-switch-handler.js — Tab 切换时重置 UI、加载历史对话、清理活跃功能

import { t } from '../../shared/i18n.js';
import * as state from '../state.js';
import { appendMessage } from './dom-helpers.js';
import { clearImagePreviews } from '../services/ocr.js';
import { updateQuotePreview } from './global-events.js';

export function cleanupActiveFeatures(els, deps) {
  if (deps.isTTSPlaying()) deps.stopTTS();
  const existingPodcast = els.chatArea.querySelector('.podcast-card');
  if (existingPodcast) existingPodcast.remove();
  if (state.getIsPodcastGenerating()) state.setIsPodcastGenerating(false);
  const existingChart = els.chatArea.querySelector('.chart-card');
  if (existingChart) existingChart.remove();
  if (state.getIsChartGenerating()) state.setIsChartGenerating(false);
}

export function handleLoadChat(els, deps, chatData) {
  cleanupActiveFeatures(els, deps);
  deps.removeSuggestQuestions();

  state.setCurrentChatId(chatData.id);
  state.setPageTitle(chatData.pageTitle || '');
  state.setPageContent(chatData.pageContent || '');
  state.setPageExcerpt(chatData.pageExcerpt || '');
  state.setConversationHistory(chatData.messages || []);
  updateQuotePreview(els, '');
  clearImagePreviews();
}

export function resetUIForTabSwitch(els, deps) {
  deps.removeSuggestQuestions();
  clearImagePreviews();
  updateQuotePreview(els, '');

  const history = state.getConversationHistory();
  els.chatArea.innerHTML = '';

  if (history.length > 0) {
    for (const msg of history) {
      if (msg.role === 'user') {
        appendMessage('user', msg.content);
      } else if (msg.role === 'assistant') {
        appendMessage('ai', msg.content);
      }
    }
  } else {
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  }
}
