import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { appendMessage } from './dom-helpers';
import { clearImagePreviews } from '../services/ocr.js';
import { updateQuotePreview } from './global-events';
import type { ChatMessage } from '../../shared/types';
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
      // TODO(Task 6): replace with appendMessageFromHistory to render
      // image_url blocks and "image lost" hints. For now, collapse array
      // content to text so tsc passes after the ChatMessage.content union.
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
      if (msg.role === 'user') {
        appendMessage('user', text);
      } else if (msg.role === 'assistant') {
        appendMessage('ai', text);
      }
    }
  } else {
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  }
}
