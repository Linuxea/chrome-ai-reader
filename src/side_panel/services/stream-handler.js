// services/stream-handler.js — SSE 流式处理 + thinking 块渲染

import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
import { emit } from '../events.js';
import {
  appendMessage, addTypingIndicator,
  removeTypingIndicator, smartScrollToBottom,
  setButtonsDisabled
} from '../ui/dom-helpers.js';
import {
  isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay
} from './tts/index.js';
import { marked } from 'marked';

let _chatArea;

export function initStreamHandler({ chatArea }) {
  _chatArea = chatArea;
}

// tabId: 发起请求的 tab，用于隔离 state 写入和 DOM 操作守卫。
export async function callAI(messages, tabId) {
  if (isTTSPlaying()) stopTTS();

  const tabState = state.getStateForTab(tabId);
  if (!tabState) return;

  tabState.isGenerating = true;
  state.persistForTab(tabId);
  setButtonsDisabled(true);

  if (isTTSAutoPlay()) {
    initTTSPlayback();
  }

  const msgEl = appendMessage('ai', '');
  const typingEl = addTypingIndicator(msgEl);
  let fullText = '';
  let thinkingText = '';
  let thinkingEl = null;
  let thinkingContentEl = null;
  let contentEl = null;

  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({
    type: 'chat',
    messages: messages
  });

  // 当前是否还在发起请求的 tab —— DOM 操作仅在此为 true 时执行
  function isCurrentTab() { return state.getActiveTabId() === tabId; }

  port.onMessage.addListener((msg) => {
    if (msg.type === 'thinking') {
      thinkingText += msg.content;
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
        thinkingContentEl.innerHTML = marked.parse(thinkingText);
        smartScrollToBottom();
      }
    } else if (msg.type === 'chunk') {
      if (thinkingEl) thinkingEl.open = false;

      fullText += msg.content;
      if (isCurrentTab() && msgEl.isConnected) removeTypingIndicator(typingEl);

      if (isCurrentTab() && msgEl.isConnected && !contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'thinking-response-content';
        msgEl.appendChild(contentEl);
      }

      if (isCurrentTab() && msgEl.isConnected && contentEl) {
        contentEl.innerHTML = marked.parse(fullText);
        smartScrollToBottom();
      }
      if (isCurrentTab() && msgEl.isConnected && isTTSAutoPlay()) {
        ttsAppendChunk(msg.content);
      }
    } else if (msg.type === 'done') {
      // 状态写入始终打到发起请求的 tab state
      tabState.conversationHistory.push({ role: 'assistant', content: fullText });
      tabState.isGenerating = false;
      state.persistForTab(tabId);
      port.disconnect();

      if (isCurrentTab()) {
        if (!msgEl.isConnected) {
          // msgEl 已被 resetUIForTabSwitch 清出 DOM，
          // conversationHistory 已更新，触发全量重渲染
          emit('requestRerender');
          setButtonsDisabled(false);
          // 重渲染后找到新的 AI message，补上 TTS 按钮和 suggest
          const newMsgEl = _chatArea.querySelector('.message-ai:last-of-type');
          if (newMsgEl) {
            addTTSButton(newMsgEl);
            initTTSAutoPlay(newMsgEl);
            emit('generateSuggestions', { msgEl: newMsgEl, history: tabState.conversationHistory });
          }
        } else {
          removeTypingIndicator(typingEl);
          if (thinkingEl) thinkingEl.open = false;
          setButtonsDisabled(false);
          addTTSButton(msgEl);
          initTTSAutoPlay(msgEl);
          emit('generateSuggestions', { msgEl, history: tabState.conversationHistory });
        }
      }
    } else if (msg.type === 'error') {
      // 回滚 user 消息 —— 始终操作发起 tab 的 state
      const hist = tabState.conversationHistory;
      if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
        hist.splice(hist.length - 1, 1);
        state.persistForTab(tabId);
      }
      tabState.isGenerating = false;
      state.persistForTab(tabId);
      port.disconnect();

      if (isCurrentTab()) {
        if (!msgEl.isConnected) {
          emit('requestRerender');
          setButtonsDisabled(false);
        } else {
          removeTypingIndicator(typingEl);
          if (thinkingEl) thinkingEl.open = false;
          const errorText = msg.errorKey ? t(msg.errorKey) : escapeHtml(msg.error || '');
          msgEl.className = 'message message-error';
          msgEl.textContent = errorText;
          setButtonsDisabled(false);
        }
      }
    }
  });

  // 断连清理 —— 回滚始终打到发起 tab 的 state
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
          state.persistForTab(tabId);
        }
      }
      tabState.isGenerating = false;
      state.persistForTab(tabId);
      if (isCurrentTab()) setButtonsDisabled(false);
    }
  });
}
