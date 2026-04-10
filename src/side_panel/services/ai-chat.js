// services/ai-chat.js — 核心对话逻辑（页面提取、快捷操作、AI 调用、消息发送）

import { t } from '../../shared/i18n.js';
import { TRUNCATE_LIMITS, safeTruncate } from '../../shared/constants.js';
import * as state from '../state.js';
import {
  appendMessage, appendMessageWithQuote, addTypingIndicator,
  removeTypingIndicator, removeLastMessage, smartScrollToBottom,
  setButtonsDisabled
} from '../ui/dom-helpers.js';
import {
  isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay
} from './tts.js';
import { getOcrRunning, hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews } from './ocr.js';
import { marked } from 'marked';

let _onRemoveSuggestQuestions;
let _onGenerateSuggestions;
let _onGenerateOutline;
let _onClearQuotePreview;
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

export function initAIChat({ chatArea, userInput, sendBtn, actionBtns, callbacks,
  isCommandPopupOpen, getFilteredCommands, renderCommandPopup, hideCommandPopup, executeQuickCommand }) {
  _chatArea = chatArea;
  _userInput = userInput;
  _sendBtn = sendBtn;
  _actionBtns = actionBtns;
  _onRemoveSuggestQuestions = callbacks.onRemoveSuggestQuestions;
  _onGenerateSuggestions = callbacks.onGenerateSuggestions;
  _onGenerateOutline = callbacks.onGenerateOutline;
  _onClearQuotePreview = callbacks.onClearQuotePreview;

  // Command popup helpers (injected from features layer to avoid layer violation)
  _isCommandPopupOpen = isCommandPopupOpen;
  _getFilteredCommands = getFilteredCommands;
  _renderCommandPopup = renderCommandPopup;
  _hideCommandPopup = hideCommandPopup;
  _executeQuickCommand = executeQuickCommand;

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
        commandSelectedIndex = (commandSelectedIndex + 1) % filtered.length;
        _renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        commandSelectedIndex = (commandSelectedIndex - 1 + filtered.length) % filtered.length;
        _renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        _executeQuickCommand(filtered[commandSelectedIndex]);
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

// Command popup selection state (managed here because keydown handler uses it)
let commandSelectedIndex = 0;

export function getCommandSelectedIndex() { return commandSelectedIndex; }
export function setCommandSelectedIndex(v) { commandSelectedIndex = v; }

export async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.setActiveTabId(tab.id);
  if (!tab) throw new Error(t('error.noTab'));

  const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
  if (!response?.success) {
    throw new Error(response?.error || t('error.extractFailed'));
  }

  state.setPageContent(response.data.textContent);
  state.setPageExcerpt(response.data.excerpt);
  state.setPageTitle(response.data.title);

  return response.data;
}

export async function handleQuickAction(action) {
  if (state.getIsGenerating()) return;

  if (action === 'outline') {
    _onGenerateOutline?.();
    return;
  }

  if (action === 'podcast') {
    return; // handled by podcast module
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
  _onRemoveSuggestQuestions?.();
  const quoteForContext = retryQuote || state.getSelectedText();

  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    const userMsgEl = appendMessageWithQuote(truncated, displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawQuote = quoteForContext;
    userMsgEl.dataset.rawDisplay = displayText;
    _onClearQuotePreview?.();
  } else {
    const userMsgEl = appendMessage('user', displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawDisplay = displayText;
  }

  try {
    await extractPageContent();

    const messages = [];
    const pageContent = state.getPageContent();
    if (pageContent) {
      const context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);

      const systemContent = t('prompt.default', { title: state.getPageTitle(), content: context });
      messages.push({
        role: 'system',
        content: systemContent
      });

      const customSystemPrompt = state.getCustomSystemPrompt();
      if (customSystemPrompt) {
        messages.push({ role: 'system', content: customSystemPrompt });
      }
    }

    const conversationHistory = state.getConversationHistory();
    messages.push(...conversationHistory);

    let historyContent = text;
    let apiContent = text;

    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
      const withQuote = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
      historyContent = withQuote;
      apiContent = withQuote;
    }

    state.pushConversation({ role: 'user', content: historyContent });

    if (ocrContext) {
      apiContent = apiContent + '\n\n' + ocrContext;
    }
    messages.push({ role: 'user', content: apiContent });

    await callAI(messages);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
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
  if (state.getIsGenerating()) return;

  if (isTTSPlaying()) stopTTS();
  _onRemoveSuggestQuestions?.();

  const children = [..._chatArea.children];
  let found = false;
  for (const child of children) {
    if (child === wrapper) found = true;
    if (found) child.remove();
  }

  const userContent = rawQuote
    ? t('ai.quotePrefix') + '\n\n' + safeTruncate(rawQuote, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated')) + '\n\n' + rawText
    : rawText;
  const conversationHistory = state.getConversationHistory();
  const idx = conversationHistory.findLastIndex(m => m.role === 'user' && m.content === userContent);
  if (idx !== -1) {
    state.spliceConversation(idx);
  }

  await sendToAI(rawText, rawDisplay, rawQuote);
}

async function callAI(messages) {
  if (isTTSPlaying()) stopTTS();

  state.setIsGenerating(true);
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

  port.onMessage.addListener((msg) => {
    if (msg.type === 'thinking') {
      thinkingText += msg.content;
      removeTypingIndicator(typingEl);

      if (!thinkingEl) {
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

      thinkingContentEl.innerHTML = marked.parse(thinkingText);
      smartScrollToBottom();
    } else if (msg.type === 'chunk') {
      if (thinkingEl) {
        thinkingEl.open = false;
        thinkingEl = null;
      }

      fullText += msg.content;
      removeTypingIndicator(typingEl);

      if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'thinking-response-content';
        msgEl.appendChild(contentEl);
      }

      contentEl.innerHTML = marked.parse(fullText);
      smartScrollToBottom();
      if (isTTSAutoPlay()) {
        ttsAppendChunk(msg.content);
      }
    } else if (msg.type === 'done') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      state.pushConversation({ role: 'assistant', content: fullText });
      state.setIsGenerating(false);
      setButtonsDisabled(false);
      port.disconnect();
      addTTSButton(msgEl);
      initTTSAutoPlay(msgEl);
      // saveCurrentChat and generateSuggestions are injected callbacks
      // saveCurrentChat is called via main.js wiring; the suggest callback handles it
      _onGenerateSuggestions?.(msgEl, state.getConversationHistory());
    } else if (msg.type === 'error') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      const errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || '');
      msgEl.innerHTML = `<span style="color:var(--error-text)">${errorText}</span>`;
      state.setIsGenerating(false);
      setButtonsDisabled(false);
      port.disconnect();
    }
  });
}
