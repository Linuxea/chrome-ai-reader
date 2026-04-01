// features/suggest-questions.js — 推荐追问

import { t } from '../../shared/i18n.js';
import * as state from '../state.js';
import { smartScrollToBottom } from '../ui/dom-helpers.js';

let _chatArea;
let _userInput;
let _onSend;
let suggestPort = null;

export function initSuggestQuestions({ chatArea, userInput, onSend }) {
  _chatArea = chatArea;
  _userInput = userInput;
  _onSend = onSend;

  chrome.storage.sync.get(['suggestQuestions'], (data) => {
    state.setSuggestQuestionsEnabled(data.suggestQuestions !== false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.suggestQuestions) {
      state.setSuggestQuestionsEnabled(changes.suggestQuestions.newValue !== false);
    }
  });
}

export function removeSuggestQuestions() {
  if (suggestPort) {
    try { suggestPort.disconnect(); } catch {}
    suggestPort = null;
  }
  const el = _chatArea.querySelector('.suggest-questions, .suggest-loading');
  if (el) el.remove();
}

export function generateSuggestions(msgEl, history) {
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
  if (lastUser) userContent += t('prompt.suggestUser') + lastUser.content + '\n\n';

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const truncated = lastAssistant.content.length > 2000
      ? lastAssistant.content.slice(0, 2000) + '...'
      : lastAssistant.content;
    userContent += t('prompt.suggestAI') + truncated;
  }

  const messages = [
    {
      role: 'system',
      content: t('prompt.suggest')
    },
    { role: 'user', content: userContent }
  ];

  const port = chrome.runtime.connect({ name: 'suggest-questions' });
  suggestPort = port;

  port.onDisconnect.addListener(() => {
    suggestPort = null;
    if (loadingEl.parentNode) loadingEl.remove();
  });

  let fullText = '';

  port.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      fullText += msg.content;
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
        item.addEventListener('click', () => {
          suggestEl.remove();
          _userInput.value = q;
          _onSend();
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
