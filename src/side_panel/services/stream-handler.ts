import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import {
  appendMessage, addTypingIndicator,
  removeTypingIndicator, smartScrollToBottom,
  setButtonsDisabled,
} from '../ui/dom-helpers';
import {
  isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay,
} from './tts/index.js';
import { marked } from 'marked';
import type { ChatMessage } from '../../shared/types';

let _chatArea: HTMLElement;

export function initStreamHandler({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
}

export async function callAI(messages: ChatMessage[], tabId: number | null): Promise<void> {
  if (isTTSPlaying()) stopTTS();

  const tabState = state.getStateForTab(tabId!);
  if (!tabState) return;

  tabState.isGenerating = true;
  state.persistForTab(tabId!);
  setButtonsDisabled(true);

  if (isTTSAutoPlay()) {
    initTTSPlayback();
  }

  const msgEl = appendMessage('ai', '');
  const typingEl = addTypingIndicator(msgEl);
  let fullText = '';
  let thinkingText = '';
  let thinkingEl: HTMLDetailsElement | null = null;
  let thinkingContentEl: HTMLDivElement | null = null;
  let contentEl: HTMLDivElement | null = null;

  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({
    type: 'chat',
    messages: messages,
  });

  function isCurrentTab(): boolean { return state.getActiveTabId() === tabId; }

  interface StreamMessage {
    type: string;
    content?: string;
    error?: string;
    errorKey?: string;
  }

  port.onMessage.addListener((msg: StreamMessage) => {
    if (msg.type === 'thinking') {
      thinkingText += msg.content || '';
      if (isCurrentTab() && msgEl.isConnected) removeTypingIndicator(typingEl);

      if (isCurrentTab() && msgEl.isConnected && !thinkingEl) {
        thinkingEl = document.createElement('details');
        thinkingEl.className = 'thinking-block';
        thinkingEl.open = true;
        const summary = document.createElement('summary');
        summary.className = 'thinking-summary';
        summary.textContent = t('ai.thinking');
        thinkingEl.appendChild(summary);
        thinkingContentEl = document.createElement('div');
        thinkingContentEl.className = 'thinking-content';
        thinkingEl.appendChild(thinkingContentEl);
        msgEl.appendChild(thinkingEl);
      }

      if (isCurrentTab() && msgEl.isConnected && thinkingContentEl) {
        thinkingContentEl.innerHTML = marked.parse(thinkingText) as string;
        smartScrollToBottom();
      }
    } else if (msg.type === 'chunk') {
      if (thinkingEl) thinkingEl.open = false;

      fullText += msg.content || '';
      if (isCurrentTab() && msgEl.isConnected) removeTypingIndicator(typingEl);

      if (isCurrentTab() && msgEl.isConnected && !contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'thinking-response-content';
        msgEl.appendChild(contentEl);
      }

      if (isCurrentTab() && msgEl.isConnected && contentEl) {
        contentEl.innerHTML = marked.parse(fullText) as string;
        smartScrollToBottom();
      }
      if (isCurrentTab() && msgEl.isConnected && isTTSAutoPlay()) {
        ttsAppendChunk(msg.content || '');
      }
    } else if (msg.type === 'done') {
      tabState.conversationHistory.push({ role: 'assistant', content: fullText });
      tabState.isGenerating = false;
      state.persistForTab(tabId!);
      port.disconnect();

      if (isCurrentTab()) {
        if (!msgEl.isConnected) {
          emit(EVENTS.REQUEST_RERENDER);
          setButtonsDisabled(false);
          const newMsgEl = _chatArea.querySelector('.message-ai:last-of-type') as HTMLElement | null;
          if (newMsgEl) {
            addTTSButton(newMsgEl);
            initTTSAutoPlay();
            emit(EVENTS.GENERATE_SUGGESTIONS, { msgEl: newMsgEl, history: tabState.conversationHistory });
          }
        } else {
          removeTypingIndicator(typingEl);
          if (thinkingEl) thinkingEl.open = false;
          setButtonsDisabled(false);
          addTTSButton(msgEl);
          initTTSAutoPlay();
          emit(EVENTS.GENERATE_SUGGESTIONS, { msgEl, history: tabState.conversationHistory });
        }
      }
    } else if (msg.type === 'error') {
      const hist = tabState.conversationHistory;
      if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
        hist.splice(hist.length - 1, 1);
        state.persistForTab(tabId!);
      }
      tabState.isGenerating = false;
      state.persistForTab(tabId!);
      port.disconnect();

      if (isCurrentTab()) {
        if (!msgEl.isConnected) {
          emit(EVENTS.REQUEST_RERENDER);
          setButtonsDisabled(false);
        } else {
          removeTypingIndicator(typingEl);
          if (thinkingEl) thinkingEl.open = false;
          const errorText = msg.errorKey ? t(msg.errorKey) : escapeHtml(msg.error || '')!;
          msgEl.className = 'message message-error';
          msgEl.textContent = errorText;
          setButtonsDisabled(false);
        }
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabState.isGenerating) {
      if (isCurrentTab() && msgEl.isConnected) {
        removeTypingIndicator(typingEl);
        if (thinkingEl) thinkingEl.open = false;
      }
      if (!fullText) {
        if (isCurrentTab() && msgEl.isConnected) {
          msgEl.className = 'message message-error';
          msgEl.textContent = t('error.apiFailed');
        }
        const hist = tabState.conversationHistory;
        if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
          hist.splice(hist.length - 1, 1);
          state.persistForTab(tabId!);
        }
      }
      tabState.isGenerating = false;
      state.persistForTab(tabId!);
      if (isCurrentTab()) setButtonsDisabled(false);
    }
  });
}
