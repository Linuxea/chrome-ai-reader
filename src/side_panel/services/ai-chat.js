// services/ai-chat.js — 核心对话逻辑（页面提取、快捷操作、AI 调用、消息发送）

import { t } from '../../shared/i18n.js';
import { TRUNCATE_LIMITS, safeTruncate, escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
import { emit } from '../events.js';
import {
  appendMessage, appendMessageWithQuote, addTypingIndicator,
  removeTypingIndicator, removeLastMessage, smartScrollToBottom,
  setButtonsDisabled
} from '../ui/dom-helpers.js';
import {
  isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay
} from './tts/index.js';
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews } from './ocr.js';
import { marked } from 'marked';

let _chatArea;
let _userInput;
let _sendBtn;
let _actionBtns;

// Quick-command helpers injected from features layer
let _isCommandPopupOpen;
let _getFilteredCommands;
let _renderCommandPopup;
let _hideCommandPopup;
let _executeQuickCommand;
let _getCommandSelectedIndex;
let _setCommandSelectedIndex;

export function initAIChat({ chatArea, userInput, sendBtn, actionBtns,
  isCommandPopupOpen, getFilteredCommands, renderCommandPopup, hideCommandPopup, executeQuickCommand,
  getCommandSelectedIndex, setCommandSelectedIndex }) {
  _chatArea = chatArea;
  _userInput = userInput;
  _sendBtn = sendBtn;
  _actionBtns = actionBtns;

  // Command popup helpers (injected from features layer to avoid layer violation)
  _isCommandPopupOpen = isCommandPopupOpen;
  _getFilteredCommands = getFilteredCommands;
  _renderCommandPopup = renderCommandPopup;
  _hideCommandPopup = hideCommandPopup;
  _executeQuickCommand = executeQuickCommand;
  _getCommandSelectedIndex = getCommandSelectedIndex;
  _setCommandSelectedIndex = setCommandSelectedIndex;

  // Event bindings
  _sendBtn.addEventListener('click', sendMessage);
  _userInput.addEventListener('keydown', handleKeydown);
  _actionBtns.forEach(btn => {
    btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
  });
}

function handleKeydown(e) {
  if (_isCommandPopupOpen()) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        _setCommandSelectedIndex((_getCommandSelectedIndex() + 1) % filtered.length);
        _renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        _setCommandSelectedIndex((_getCommandSelectedIndex() - 1 + filtered.length) % filtered.length);
        _renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        _executeQuickCommand(filtered[_getCommandSelectedIndex()]);
      } else {
        _hideCommandPopup();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _hideCommandPopup();
      return;
    }
  }

  // Enter 发送
  if (!_isCommandPopupOpen() && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

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

export async function handleQuickAction(action) {
  if (state.getIsGenerating()) return;

  if (action === 'outline') {
    emit('generateOutline');
    return;
  }

  if (action === 'podcast') {
    emit('podcastClick');
    return;
  }

  if (action === 'chart') {
    emit('chartClick');
    return;
  }

  if (state.getOcrRunning() > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  if (hasImageErrors()) {
    const firstError = document.querySelector('.image-preview-item.error');
    const reason = firstError?.title || '';
    appendMessage('error', t('error.ocrPartialFail') + (reason ? `：${reason}` : ''));
    return;
  }

  const selectedText = state.getSelectedText();
  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts = {
    summarize: hasSelection ? t('prompt.summarize.quote') : t('prompt.summarize.full'),
    translate: hasSelection ? t('prompt.translate.quote') : t('prompt.translate.full'),
    keyInfo: hasSelection ? t('prompt.keyInfo.quote') : t('prompt.keyInfo.full')
  };

  const actionNames = {
    summarize: t('action.summarize'),
    translate: t('action.translate'),
    keyInfo: t('action.keyInfo')
  };

  const ocrContext = buildOcrContext();
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await sendToAI(actionPrompts[action], actionNames[action], undefined, ocrContext, imageUris);
}

export async function sendToAI(text, displayText, retryQuote, ocrContext, imageUris) {
  emit('removeSuggestQuestions');

  // 捕捉发起请求时的 tabId 和 state 引用 —— 全程直接操作该对象，
  // 避免切 tab 后 _activeState 指针变化导致数据写入错误的目标。
  const startTabId = state.getActiveTabId();
  const tabState = state.getStateForTab(startTabId);
  if (!tabState) return;

  tabState.isGenerating = true;
  state.persistForTab(startTabId);
  setButtonsDisabled(true);

  const quoteForContext = retryQuote || tabState.selectedText;

  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    const userMsgEl = appendMessageWithQuote(truncated, displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawQuote = quoteForContext;
    userMsgEl.dataset.rawDisplay = displayText;
    emit('clearQuotePreview');
  } else {
    const userMsgEl = appendMessage('user', displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawDisplay = displayText;
  }

  try {
    // 仅会话首条消息或缓存为空时提取页面，后续消息复用 tabState.pageContent
    if (!tabState.conversationHistory.length || !tabState.pageContent) {
      await extractPageContent(startTabId);
    }

    const messages = [];
    const pageContent = tabState.pageContent || '';
    if (pageContent) {
      const context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);
      const systemContent = t('prompt.default', { title: tabState.pageTitle, content: context });
      messages.push({ role: 'system', content: systemContent });

      const customSystemPrompt = state.getCustomSystemPrompt();
      if (customSystemPrompt) {
        messages.push({ role: 'system', content: customSystemPrompt });
      }
    }

    const conversationHistory = tabState.conversationHistory || [];
    messages.push(...conversationHistory);

    let historyContent = text;
    let apiContent = text;

    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
      const withQuote = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
      historyContent = withQuote;
      apiContent = withQuote;
    }

    tabState.conversationHistory.push({ role: 'user', content: historyContent });
    state.persistForTab(startTabId);

    if (ocrContext) {
      apiContent = apiContent + '\n\n' + ocrContext;
    }
    messages.push({ role: 'user', content: apiContent });

    await callAI(messages, startTabId);
  } catch (e) {
    // UI 清理仅在未切 tab 时执行 —— 已切 tab 的话 DOM 已被 resetUIForTabSwitch 清空
    if (state.getActiveTabId() === startTabId) {
      removeLastMessage();
      appendMessage('error', e.message);
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
    // 回滚始终打到发起请求的 tab state
    const hist = tabState.conversationHistory;
    if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
      hist.splice(hist.length - 1, 1);
      state.persistForTab(startTabId);
    }
    tabState.isGenerating = false;
    state.persistForTab(startTabId);
  }
}

export async function sendMessage() {
  const text = _userInput.value.trim();
  if (!text || state.getIsGenerating()) return;

  if (state.getOcrRunning() > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  if (hasImageErrors()) {
    const firstError = document.querySelector('.image-preview-item.error');
    const reason = firstError?.title || '';
    appendMessage('error', t('error.ocrPartialFail') + (reason ? `：${reason}` : ''));
    return;
  }

  _userInput.value = '';
  _userInput.style.height = 'auto';

  const ocrContext = buildOcrContext();
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await sendToAI(text, text, undefined, ocrContext, imageUris);
}

export async function retryMessage(wrapper, rawText, rawDisplay, rawQuote) {
  const startTabId = state.getActiveTabId();
  const tabState = state.getStateForTab(startTabId);
  if (!tabState || tabState.isGenerating) return;

  if (isTTSPlaying()) stopTTS();
  emit('removeSuggestQuestions');

  // Reset podcast/chart generating flags so their buttons aren't permanently disabled.
  if (tabState.isPodcastGenerating) tabState.isPodcastGenerating = false;
  if (tabState.isChartGenerating) tabState.isChartGenerating = false;
  state.persistForTab(startTabId);

  const children = [..._chatArea.children];
  let found = false;
  for (const child of children) {
    if (child === wrapper) found = true;
    if (found) child.remove();
  }

  const userContent = rawQuote
    ? t('ai.quotePrefix') + '\n\n' + safeTruncate(rawQuote, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated')) + '\n\n' + rawText
    : rawText;
  const conversationHistory = tabState.conversationHistory;
  const idx = conversationHistory.findLastIndex(m => m.role === 'user' && m.content === userContent);
  if (idx !== -1) {
    // Remove the user message and all subsequent messages (assistant replies, etc.)
    conversationHistory.splice(idx, conversationHistory.length - idx);
    state.persistForTab(startTabId);
  }

  await sendToAI(rawText, rawDisplay, rawQuote);
}

// tabId: 发起请求的 tab，用于隔离 state 写入和 DOM 操作守卫。
async function callAI(messages, tabId) {
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
