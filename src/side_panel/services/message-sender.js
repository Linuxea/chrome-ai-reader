// services/message-sender.js — 消息组装、发送入口、重试

import { t } from '../../shared/i18n.js';
import { TRUNCATE_LIMITS, safeTruncate } from '../../shared/constants.js';
import * as state from '../state.js';
import { emit } from '../events.js';
import {
  appendMessage, appendMessageWithQuote,
  removeLastMessage, setButtonsDisabled
} from '../ui/dom-helpers.js';
import {
  isTTSPlaying, stopTTS
} from './tts/index.js';
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews } from './ocr.js';
import { extractPageContent } from './page-extractor.js';
import { callAI } from './stream-handler.js';

let _chatArea;
let _userInput;

export function initMessageSender({ chatArea, userInput }) {
  _chatArea = chatArea;
  _userInput = userInput;
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
