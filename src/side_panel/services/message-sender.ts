import { t } from '../../shared/i18n.js';
import { getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import { TRUNCATE_LIMITS, safeTruncate } from '../../shared/constants';
import { toErrorMessage } from '../../shared/utils';
import { getSync } from '../../platform/storage';
import type { ChatMessage, MessageContentPart } from '../../shared/types';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import {
  appendMessage, appendMessageWithQuote,
  removeLastMessage, setButtonsDisabled,
} from '../ui/dom-helpers';
import { isTTSPlaying, stopTTS } from './tts/index.js';
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews, validateImageState } from './ocr.js';
import { ensurePageContent } from './page-extractor';
import { callAI } from './stream-handler';
import { appendMessage as appendHistory, rollbackTrailingUserMessage, truncateHistoryFromUserContent } from './chat/history-ops';
import { extractImageUrisFromContent } from '../ui/dom-helpers';

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
    // Ensure the page has been extracted at least once for this tab. This is
    // the single entry point for extraction — history state is irrelevant;
    // only the pageContent cache decides whether to actually extract.
    const extractResult = await ensurePageContent(startTabId);
    if (!extractResult.ok) throw extractResult.error;

    const messages: ChatMessage[] = [];
    const pageContent = tabState.pageContent || '';
    if (pageContent) {
      const context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);
      const lang = getCurrentLang();
      // Two system messages: [1] rules + custom (short, ~200 chars), [2] the
      // article as reference data. Splitting them keeps the custom prompt in a
      // short instruction message where the model still attends to it, instead
      // of being buried under thousands of characters of article text. OpenAI
      // and DeepSeek both honor multiple system messages correctly.
      const customSystemPrompt = state.getCustomSystemPrompt();
      const customBlock = customSystemPrompt
        ? `【补充要求】\n${customSystemPrompt}`
        : '';
      const ruleContent = getPrompt('default', lang, { custom: customBlock });
      const articleContent = getPrompt('default.article', lang, {
        title: tabState.pageTitle,
        content: context ?? '',
      });
      messages.push({ role: 'system', content: ruleContent });
      messages.push({ role: 'system', content: articleContent });
    }

    const conversationHistory = tabState.conversationHistory || [];
    messages.push(...conversationHistory);

    let apiContent = text;

    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
      const withQuote = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
      apiContent = withQuote;
    }

    const { visionEnabled } = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
    const visionOn = visionEnabled === true;
    const hasImages = visionOn && imageUris !== undefined && imageUris.length > 0;

    let userMessage: ChatMessage;
    if (hasImages) {
      const parts: MessageContentPart[] = [];
      if (apiContent) parts.push({ type: 'text', text: apiContent });
      for (const uri of imageUris!) parts.push({ type: 'image_url', image_url: { url: uri } });
      userMessage = { role: 'user', content: parts, hadImages: true };
    } else {
      if (ocrContext) apiContent = apiContent + '\n\n' + ocrContext;
      userMessage = { role: 'user', content: apiContent };
    }
    messages.push(userMessage);
    appendHistory(tabState, userMessage, startTabId!);

    if (hasImages) {
      const totalBytes = imageUris!.reduce((sum, u) => sum + u.length, 0);
      if (totalBytes > 10 * 1024 * 1024) {
        throw new Error(t('error.visionPayloadTooLarge'));
      }
    }

    await callAI(messages, startTabId);
  } catch (e: unknown) {
    const errMsg = toErrorMessage(e);
    if (state.getActiveTabId() === startTabId) {
      removeLastMessage();
      appendMessage('error', errMsg);
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
    rollbackTrailingUserMessage(tabState, startTabId!);
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
  await resendUserMessage({ wrapper, lookupText: rawText, sendText: rawText, sendDisplay: rawDisplay, rawQuote });
}

/**
 * Edit a user message in place and resend. `originalRawText` is used to locate
 * + truncate the existing history entry (it must match what was originally
 * sent); `editedText` is the new text to send and display.
 */
export async function editMessage(
  wrapper: HTMLElement,
  originalRawText: string,
  editedText: string,
  rawQuote?: string,
): Promise<void> {
  await resendUserMessage({ wrapper, lookupText: originalRawText, sendText: editedText, sendDisplay: editedText, rawQuote });
}

/**
 * Shared core for retry (resend original) and edit (resend modified).
 * Tears down the DOM from `wrapper` onward, truncates conversation history at
 * the user message identified by `lookupText` (capturing any images first),
 * then re-sends via sendToAI with `sendText`.
 */
async function resendUserMessage(opts: {
  wrapper: HTMLElement;
  lookupText: string;
  sendText: string;
  sendDisplay: string;
  rawQuote?: string;
}): Promise<void> {
  const { wrapper, lookupText, sendText, sendDisplay, rawQuote } = opts;
  const startTabId = state.getActiveTabId();
  const tabState = state.getStateForTab(startTabId!);
  if (!tabState || tabState.isGenerating) return;

  if (isTTSPlaying()) stopTTS();
  emit(EVENTS.REMOVE_SUGGEST_QUESTIONS);

  if (tabState.isPodcastGenerating) tabState.isPodcastGenerating = false;
  state.persistForTab(startTabId!);

  const children = [..._chatArea.children];
  let found = false;
  for (const child of children) {
    if (child === wrapper) found = true;
    if (found) child.remove();
  }

  const userContent = rawQuote
    ? t('ai.quotePrefix') + '\n\n' + safeTruncate(rawQuote, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated')) + '\n\n' + lookupText
    : lookupText;

  // Before truncating, extract any images from the user message being retried
  // (visual messages store image_url blocks in content array). After truncate
  // these are gone from history, so we capture them now to re-send.
  const retriedImages = extractImagesForRetry(tabState, userContent);

  truncateHistoryFromUserContent(tabState, userContent, startTabId!);

  await sendToAI(sendText, sendDisplay, rawQuote, undefined, retriedImages);
}

/**
 * Find the user message matching `userContent` in history and extract its
 * image_url blocks. Used by retryMessage to re-send images that were part of
 * the original visual message but whose preview-bar thumbnails were already
 * cleared by a prior sendMessage.
 */
function extractImagesForRetry(tabState: { conversationHistory: ChatMessage[] }, userContent: string): string[] | undefined {
  const hist = tabState.conversationHistory;
  const idx = hist.findLastIndex(m =>
    m.role === 'user' && typeof m.content !== 'string' &&
    m.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n') === userContent,
  );
  if (idx === -1) return undefined;
  return extractImageUrisFromContent(hist[idx]);
}
