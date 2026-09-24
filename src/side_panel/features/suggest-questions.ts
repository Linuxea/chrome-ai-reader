import { t } from '../../shared/i18n.js';
import { getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import { onSyncChange } from '../../platform/storage';
import * as state from '../state';
import { smartScrollToBottom } from '../ui/dom-helpers';
import { appendDraftText } from '../services/composer';
import type { ChatMessage } from '../../shared/types';

let _chatArea: HTMLElement;
let suggestPort: chrome.runtime.Port | null = null;

export function initSuggestQuestions({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;

  chrome.storage.sync.get(['suggestQuestions'], (data) => {
    state.setSuggestQuestionsEnabled(data.suggestQuestions !== false);
  });

  onSyncChange('suggestQuestions', (newValue) => {
    state.setSuggestQuestionsEnabled(newValue !== false);
  });
}

export function removeSuggestQuestions(): void {
  if (suggestPort) {
    try { suggestPort.disconnect(); } catch { /* cleanup */ }
    suggestPort = null;
  }
  const el = _chatArea.querySelector('.suggest-questions, .suggest-loading');
  if (el) el.remove();
}

/** Text of a (possibly multimodal) message; an image-only message reads as a placeholder. */
function contentAsText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  const text = content
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('\n');
  return text || t('chat.imageOnly');
}

export function generateSuggestions(msgEl: HTMLElement, history: ChatMessage[]): void {
  if (!state.isSuggestQuestionsEnabled()) return;

  const loadingEl = document.createElement('div');
  loadingEl.className = 'suggest-loading';
  loadingEl.innerHTML = `
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
  `;
  msgEl.after(loadingEl);

  const recentHistory = history.slice(-4);
  const userMessages = recentHistory.filter(m => m.role === 'user');
  const assistantMessages = recentHistory.filter(m => m.role === 'assistant');

  let userContent = '';
  const lastUser = userMessages[userMessages.length - 1];
  if (lastUser) userContent += getPrompt('suggest.userLabel', getCurrentLang()) + contentAsText(lastUser.content) + '\n\n';

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const assistantText = contentAsText(lastAssistant.content);
    const truncated = assistantText.length > 2000
      ? assistantText.slice(0, 2000) + '...'
      : assistantText;
    userContent += getPrompt('suggest.aiLabel', getCurrentLang()) + truncated;
  }

  const messages = [
    { role: 'system' as const, content: getPrompt('suggest', getCurrentLang()) },
    { role: 'user' as const, content: userContent },
  ];

  const port = chrome.runtime.connect({ name: 'suggest-questions' });
  suggestPort = port;

  port.onDisconnect.addListener(() => {
    suggestPort = null;
    if (loadingEl.parentNode) loadingEl.remove();
  });

  let fullText = '';

  port.onMessage.addListener((msg: { type: string; content?: string; error?: string }) => {
    if (msg.type === 'chunk') {
      fullText += msg.content || '';
    } else if (msg.type === 'done') {
      port.disconnect();
      suggestPort = null;
      if (!msgEl.parentNode) return;
      const questions = fullText
        .split('\n')
        .map(q => q.replace(/^[\d]+[.、)\s]*/, '').trim())
        .filter(q => q.length > 0)
        .slice(0, 3);

      if (loadingEl.parentNode) loadingEl.remove();

      if (questions.length === 0) return;

      const suggestEl = document.createElement('div');
      suggestEl.className = 'suggest-questions';

      questions.forEach(q => {
        const item = document.createElement('button');
        item.className = 'suggest-item';
        item.textContent = q;
        // Fill the question into the input (never auto-send, never clobber a
        // draft) so the user can adjust it and send it with the normal button.
        item.addEventListener('click', () => {
          appendDraftText(q, { focus: true });
        });
        suggestEl.appendChild(item);
      });

      msgEl.after(suggestEl);
      smartScrollToBottom();
    } else if (msg.type === 'error') {
      port.disconnect();
      suggestPort = null;
      if (loadingEl.parentNode) loadingEl.remove();
    }
  });

  port.postMessage({ type: 'suggest', messages });
}
