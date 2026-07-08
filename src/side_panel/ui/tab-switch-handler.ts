import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import { appendMessage, appendMessageFromHistory } from './dom-helpers';
import { clearImagePreviews } from '../services/ocr.js';
import { updateQuotePreview } from './global-events';
import type { ChatMessage } from '../../shared/types';
import type { UIElements, GlobalEventDeps } from './global-events';

export function cleanupActiveFeatures(els: UIElements, deps: GlobalEventDeps): void {
  if (deps.isTTSPlaying()) deps.stopTTS();
  // Podcast audio/state is NOT torn down on tab switch — it is a window-global
  // single stream that keeps playing in the background (mini-player reflects it).
  // Only detach the card DOM from the outgoing tab; the now-playing metadata
  // survives and the full card is rebuilt on return to the origin tab.
  const existingPodcast = els.chatArea.querySelector('.podcast-card');
  if (existingPodcast) existingPodcast.remove();
}

export function handleLoadChat(els: UIElements, deps: GlobalEventDeps, chatData: {
  id: string;
  pageTitle?: string;
  pageContent?: string;
  pageExcerpt?: string;
  messages?: ChatMessage[];
}): void {
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

export function resetUIForTabSwitch(els: UIElements, deps: GlobalEventDeps): void {
  deps.removeSuggestQuestions();
  clearImagePreviews();
  updateQuotePreview(els, '');

  const history = state.getConversationHistory();
  els.chatArea.innerHTML = '';

  if (history.length > 0) {
    for (const msg of history) {
      appendMessageFromHistory(msg);
    }
  } else {
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  }

  // After the chat area is rebuilt, ask the podcast feature to restore its
  // full card if the now-playing podcast originated from this tab. Decouples
  // ui/** from the podcast feature (mirrors the PAGE_EXTRACTED pattern).
  emit(EVENTS.PODCAST_REBUILD_REQUEST);
}
