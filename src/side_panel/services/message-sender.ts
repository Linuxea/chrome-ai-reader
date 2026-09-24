import { t } from '../../shared/i18n.js';
import { getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import { TRUNCATE_LIMITS, safeTruncate } from '../../shared/constants';
import { toErrorMessage } from '../../shared/utils';
import type { ChatMessage, MessageContentPart } from '../../shared/types';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import {
  appendMessage, appendMessageWithQuote,
  appendErrorMessage, emitRetryFromWrapper,
  setButtonsDisabled, updateSendButtonDim,
} from '../ui/dom-helpers';
import { isTTSPlaying, stopTTS } from './tts/index.js';
import { getDraftText, clearDraftText, consumeAttachments, hasAttachments } from './composer';
import { ensurePageContent } from './page-extractor';
import { callAI, abortGeneration } from './stream-handler';
import { appendMessage as appendHistory, rollbackTrailingUserMessage, truncateHistoryFromUserContent } from './chat/history-ops';
import { extractImageUrisFromContent } from '../ui/dom-helpers';

let _chatArea: HTMLElement;

export function initMessageSender({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
}

export async function sendToAI(
  text: string,
  displayText: string,
  retryQuote?: string,
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

  let userMsgEl: HTMLDivElement;
  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    userMsgEl = appendMessageWithQuote(truncated, displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawQuote = quoteForContext;
    userMsgEl.dataset.rawDisplay = displayText;
    emit(EVENTS.CLEAR_QUOTE_PREVIEW);
  } else {
    userMsgEl = appendMessage('user', displayText, imageUris);
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

    const hasImages = imageUris !== undefined && imageUris.length > 0;

    let userMessage: ChatMessage;
    if (hasImages) {
      const parts: MessageContentPart[] = [];
      if (apiContent) parts.push({ type: 'text', text: apiContent });
      for (const uri of imageUris!) parts.push({ type: 'image_url', image_url: { url: uri } });
      userMessage = { role: 'user', content: parts, hadImages: true };
    } else {
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
      // Keep the user bubble — removing it used to destroy the typed text with
      // no way back. The retry action re-sends it via the RETRY event; history
      // was already rolled back below, so the re-truncate is a no-op.
      const wrapper = userMsgEl.closest('.user-msg-group') as HTMLElement | null;
      const actions = wrapper
        ? [{ label: t('action.retry'), onClick: () => emitRetryFromWrapper(wrapper) }]
        : [];
      appendErrorMessage(errMsg, actions);
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
    rollbackTrailingUserMessage(tabState, startTabId!);
    tabState.isGenerating = false;
    state.persistForTab(startTabId!);
  }
}

/**
 * What an entry point wants to send. The composer supplies the rest (draft
 * text, images), so every entry point sends the same way.
 *
 * - No `prompt` (Enter / send button): the draft text itself is the message
 *   (may be empty when images are pending — an image-only message).
 * - With `prompt` (quick action, quick command): the prompt is sent and
 *   `display` shown in the bubble; a non-empty draft rides along as extra
 *   instructions. `draft` overrides the input value (quick commands pass the
 *   text typed after `/name`).
 */
export interface SubmitIntent {
  prompt?: string;
  display?: string;
  draft?: string;
}

/**
 * The single "send" pipeline: guard → take the draft (text + images) out of
 * the composer → sendToAI. sendToAI marks the tab as generating before its
 * first await, so a second submit is rejected by the guard.
 */
export async function submit(intent: SubmitIntent = {}): Promise<void> {
  /* While a generation is running the send button shows the stop icon; its
     click aborts (handled by the ai-chat click listener). Keyboard sends
     (Enter) must never abort — typing ahead is normal, so just ignore. */
  if (state.getIsGenerating()) return;

  const draft = intent.draft ?? getDraftText();
  const isFreeText = intent.prompt === undefined;
  // A free-text send needs text or images — images alone are a valid message.
  if (isFreeText && !draft && !hasAttachments()) {
    updateSendButtonDim();
    return;
  }

  let text: string;
  let display: string;
  if (isFreeText) {
    text = draft;
    display = draft;
  } else {
    const supplement = draft ? getPrompt('draft.supplement', getCurrentLang(), { draft }) : '';
    text = supplement ? `${intent.prompt}\n\n${supplement}` : intent.prompt!;
    const label = intent.display ?? intent.prompt!;
    display = draft ? `${label} · ${draft}` : label;
  }

  clearDraftText();
  const { imageUris } = consumeAttachments();
  await sendToAI(text, display, undefined, imageUris);
}

/** Enter / send button. */
export async function sendMessage(): Promise<void> {
  await submit();
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

  // Capture the bubble's image thumbnails before it is torn down — the
  // fallback when a failed send already rolled the history entry (and its
  // images) back.
  const bubbleImages = Array.from(wrapper.querySelectorAll<HTMLImageElement>('.bubble-images img')).map(img => img.src);

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
  const retriedImages = extractImagesForRetry(tabState, userContent)
    ?? (bubbleImages.length > 0 ? bubbleImages : undefined);

  truncateHistoryFromUserContent(tabState, userContent, startTabId!);

  await sendToAI(sendText, sendDisplay, rawQuote, retriedImages);
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
