import { t } from '../../shared/i18n.js';
import { TRUNCATE_LIMITS, safeTruncate } from '../../shared/constants';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import {
  appendMessage, appendMessageWithQuote,
  removeLastMessage, setButtonsDisabled,
} from '../ui/dom-helpers';
import { isTTSPlaying, stopTTS } from './tts/index.js';
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews, validateImageState } from './ocr.js';
import { extractPageContent } from './page-extractor';
import { callAI } from './stream-handler';

let _chatArea: HTMLElement;
let _userInput: HTMLTextAreaElement;

export function initMessageSender({ chatArea, userInput }: { chatArea: HTMLElement; userInput: HTMLTextAreaElement }): void {
  _chatArea = chatArea;
  _userInput = userInput;
}

export async function sendToAI(
  text: string,
  displayText: string,
  retryQuote?: string,
  ocrContext?: string,
  imageUris?: string[],
): Promise<void> {
  emit(EVENTS.REMOVE_SUGGEST_QUESTIONS);

  const startTabId = state.getActiveTabId();
  const tabState = state.getStateForTab(startTabId!);
  if (!tabState) return;

  tabState.isGenerating = true;
  state.persistForTab(startTabId!);
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
    emit(EVENTS.CLEAR_QUOTE_PREVIEW);
  } else {
    const userMsgEl = appendMessage('user', displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawDisplay = displayText;
  }

  try {
    if (!tabState.conversationHistory.length || !tabState.pageContent) {
      const extractResult = await extractPageContent(startTabId);
      if (!extractResult.ok) throw extractResult.error;
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
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
    state.persistForTab(startTabId!);

    if (ocrContext) {
      apiContent = apiContent + '\n\n' + ocrContext;
    }
    messages.push({ role: 'user', content: apiContent });

    await callAI(messages, startTabId);
  } catch (e: unknown) {
    const err = e as Error;
    if (state.getActiveTabId() === startTabId) {
      removeLastMessage();
      appendMessage('error', err.message);
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
    const hist = tabState.conversationHistory;
    if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
      hist.splice(hist.length - 1, 1);
      state.persistForTab(startTabId!);
    }
    tabState.isGenerating = false;
    state.persistForTab(startTabId!);
  }
}

export async function sendMessage(): Promise<void> {
  const text = _userInput.value.trim();
  if (!text || state.getIsGenerating()) return;

  const imageError = validateImageState();
  if (imageError) {
    appendMessage('error', imageError);
    return;
  }

  _userInput.value = '';
  _userInput.style.height = 'auto';

  const ocrContext = buildOcrContext();
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await sendToAI(text, text, undefined, ocrContext, imageUris);
}

export async function retryMessage(
  wrapper: HTMLElement,
  rawText: string,
  rawDisplay: string,
  rawQuote?: string,
): Promise<void> {
  const startTabId = state.getActiveTabId();
  const tabState = state.getStateForTab(startTabId!);
  if (!tabState || tabState.isGenerating) return;

  if (isTTSPlaying()) stopTTS();
  emit(EVENTS.REMOVE_SUGGEST_QUESTIONS);

  if (tabState.isPodcastGenerating) tabState.isPodcastGenerating = false;
  if (tabState.isChartGenerating) tabState.isChartGenerating = false;
  state.persistForTab(startTabId!);

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
    conversationHistory.splice(idx, conversationHistory.length - idx);
    state.persistForTab(startTabId!);
  }

  await sendToAI(rawText, rawDisplay, rawQuote);
}
