import { t } from '../../shared/i18n.js';
import { getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import { TRUNCATE_LIMITS, safeTruncate } from '../../shared/constants';
import { toErrorMessage } from '../../shared/utils';
import { genId } from '../../shared/ids';
import type { ChatMessage, MessageContentPart, UserMessageMeta } from '../../shared/types';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import {
  appendMessage, appendUserMessage, appendNoteMessage,
  appendErrorMessage, emitRetryFromWrapper,
  setButtonsDisabled, updateSendButtonDim,
} from '../ui/dom-helpers';
import { isTTSPlaying, stopTTS } from './tts/index.js';
import { getDraftText, clearDraftText, consumeAttachments, hasAttachments, attachmentsTooLarge, MAX_IMAGE_PAYLOAD_BYTES } from './composer';
import { ensurePageContent } from './page-extractor';
import { callAI, takePendingAbort } from './stream-handler';
import { appendMessage as appendHistory, rollbackTrailingUserMessage, truncateHistoryFromUserContent, truncateHistoryFromId, toApiMessage } from './chat/history-ops';
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

  state.setGeneratingForTab(startTabId!, true);
  setButtonsDisabled(true);

  const quoteForContext = retryQuote || tabState.selectedText;

  const meta: UserMessageMeta = { rawText: text, displayText };
  if (quoteForContext) meta.quote = quoteForContext;
  const msgId = genId();
  const userMsgEl = appendUserMessage({ ...meta, imageUris, id: msgId });
  if (quoteForContext) emit(EVENTS.CLEAR_QUOTE_PREVIEW);

  try {
    // Ensure the page has been extracted at least once for this tab. This is
    // the single entry point for extraction — history state is irrelevant;
    // only the pageContent cache decides whether to actually extract.
    const extractResult = await ensurePageContent(startTabId);
    if (takePendingAbort(startTabId!)) {
      // Stop was pressed while the page was being extracted: nothing was
      // sent or added to history — just end the turn (the bubble keeps retry).
      state.setGeneratingForTab(startTabId!, false);
      if (state.getActiveTabId() === startTabId) {
        appendNoteMessage(t('ai.stopped'));
        setButtonsDisabled(false);
      }
      return;
    }
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
        ? getPrompt('default.custom', lang, { custom: customSystemPrompt })
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
    messages.push(...conversationHistory.map(toApiMessage));

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
      userMessage = { id: msgId, role: 'user', content: parts, hadImages: true, meta };
    } else {
      userMessage = { id: msgId, role: 'user', content: apiContent, meta };
    }
    messages.push(toApiMessage(userMessage));
    appendHistory(tabState, userMessage, startTabId!);

    if (hasImages) {
      const totalBytes = imageUris!.reduce((sum, u) => sum + u.length, 0);
      if (totalBytes > MAX_IMAGE_PAYLOAD_BYTES) {
        throw new Error(t('error.visionPayloadTooLarge'));
      }
    }

    await callAI(messages, startTabId);
  } catch (e: unknown) {
    takePendingAbort(startTabId!); // a Stop racing the failure is moot now
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
      setButtonsDisabled(false);
    }
    rollbackTrailingUserMessage(tabState, startTabId!);
    state.setGeneratingForTab(startTabId!, false);
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

  if (attachmentsTooLarge()) {
    appendMessage('error', t('error.visionPayloadTooLarge'));
    return; // nothing consumed: text and images stay for the user to trim
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
  msgId?: string,
): Promise<void> {
  await resendUserMessage({ wrapper, lookupText: rawText, sendText: rawText, sendDisplay: rawDisplay, rawQuote, msgId });
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
  msgId?: string,
): Promise<void> {
  await resendUserMessage({ wrapper, lookupText: originalRawText, sendText: editedText, sendDisplay: editedText, rawQuote, msgId });
}

/**
 * Shared core for retry (resend original) and edit (resend modified).
 * Tears down the DOM from `wrapper` onward, truncates conversation history at
 * the user message identified by `msgId` (legacy bubbles without an id fall
 * back to matching `lookupText`), capturing any images first, then re-sends
 * via sendToAI with `sendText`.
 */
async function resendUserMessage(opts: {
  wrapper: HTMLElement;
  lookupText: string;
  sendText: string;
  sendDisplay: string;
  rawQuote?: string;
  msgId?: string;
}): Promise<void> {
  const { wrapper, lookupText, sendText, sendDisplay, rawQuote, msgId } = opts;
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
  const retriedImages = extractImagesForRetry(tabState, userContent, msgId)
    ?? (bubbleImages.length > 0 ? bubbleImages : undefined);

  if (msgId) truncateHistoryFromId(tabState, msgId, startTabId!);
  else truncateHistoryFromUserContent(tabState, userContent, startTabId!);

  await sendToAI(sendText, sendDisplay, rawQuote, retriedImages);
}

/**
 * Find the user message matching `userContent` in history and extract its
 * image_url blocks. Used by retryMessage to re-send images that were part of
 * the original visual message but whose preview-bar thumbnails were already
 * cleared by a prior sendMessage.
 */
function extractImagesForRetry(tabState: { conversationHistory: ChatMessage[] }, userContent: string, msgId?: string): string[] | undefined {
  const hist = tabState.conversationHistory;
  const idx = msgId
    ? hist.findIndex(m => m.id === msgId && typeof m.content !== 'string')
    : hist.findLastIndex(m =>
      m.role === 'user' && typeof m.content !== 'string' &&
      m.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n') === userContent,
    );
  if (idx === -1) return undefined;
  return extractImageUrisFromContent(hist[idx]);
}
