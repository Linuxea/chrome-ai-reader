import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { appendMessage, appendMessageFromHistory } from './dom-helpers';
import { clearImagePreviews } from '../services/ocr.js';
import { updateQuotePreview } from './global-events';
import type { ChatMessage, ArticleSummaryStatus } from '../../shared/types';
import type { UIElements, GlobalEventDeps } from './global-events';

export function cleanupActiveFeatures(els: UIElements, deps: GlobalEventDeps): void {
  if (deps.isTTSPlaying()) deps.stopTTS();
  const existingPodcast = els.chatArea.querySelector('.podcast-card');
  if (existingPodcast) existingPodcast.remove();
  if (state.getIsPodcastGenerating()) state.setIsPodcastGenerating(false);
}

export function handleLoadChat(els: UIElements, deps: GlobalEventDeps, chatData: {
  id: string;
  pageTitle?: string;
  pageContent?: string;
  pageExcerpt?: string;
  articleSummary?: string;
  articleSummaryStatus?: ArticleSummaryStatus;
  articleSummaryUrl?: string;
  messages?: ChatMessage[];
}): void {
  cleanupActiveFeatures(els, deps);
  deps.removeSuggestQuestions();

  state.setCurrentChatId(chatData.id);
  state.setPageTitle(chatData.pageTitle || '');
  state.setPageContent(chatData.pageContent || '');
  state.setPageExcerpt(chatData.pageExcerpt || '');
  state.setArticleSummary(chatData.articleSummary || '');
  state.setArticleSummaryStatus(chatData.articleSummaryStatus || 'idle');
  state.setArticleSummaryUrl(chatData.articleSummaryUrl || '');
  state.setConversationHistory(chatData.messages || []);
  updateQuotePreview(els, '');
  clearImagePreviews();
}

export function resetUIForTabSwitch(els: UIElements, deps: GlobalEventDeps): void {
  deps.removeSuggestQuestions();
  clearImagePreviews();
  updateQuotePreview(els, '');

  const history = state.getConversationHistory();
  els.chatArea.innerHTML = '';

  const summary = state.getArticleSummary();
  const summaryStatus = state.getArticleSummaryStatus();

  if (history.length > 0 || summary || summaryStatus === 'generating') {
    for (const msg of history) {
      appendMessageFromHistory(msg);
    }
  } else {
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  }
}
