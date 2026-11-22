/**
 * Send pipeline — the React port of message-sender's assembly + submit
 * orchestration. The DOM half (appendUserMessage bubbles, retry DOM
 * teardown, rescueing images from <img> tags) is gone: the user message is
 * appended to history BEFORE extraction so React renders it instantly, and
 * retry/edit re-send from history DATA (images ride inside the message's
 * content parts — no DOM rescue needed).
 *
 * Kept verbatim from the legacy pipeline:
 * - submit() guard chain: generating → ignore; free text needs text or
 *   images; oversized attachments stay put with an error toast.
 * - Quick-action / quick-command intents: prompt sent, display label shown,
 *   a non-empty draft rides along as extra instructions (draft.supplement).
 * - Two system messages (rules + budgeted article), multitab context blocks,
 *   trimmed history, quote-prefixed user content, multimodal image parts.
 * - The failed-send contract: the user message stays VISIBLE (kept on the
 *   stream entry by the controller) but is rolled back from history, so
 *   retry re-sends it cleanly.
 */
import { t, getCurrentLang } from '@/shared/i18n.js';
import { getPrompt } from '@/shared/prompts';
import { TRUNCATE_LIMITS, safeTruncate, MAX_IMAGE_PAYLOAD_BYTES } from '@/shared/constants';
import { toErrorMessage } from '@/shared/utils';
import { genId } from '@/shared/ids';
import { buildPageContext, splitParagraphs, trimHistory } from '@/shared/context-builder';
import { readSettings } from '@/platform/settings';
import type { ChatMessage, MessageContentPart, UserMessageMeta } from '@/shared/types';
import * as core from '@/panel/state';
import * as historyOps from '@/panel/lib/history-ops';
import type { AttachedTab } from '@/panel/stores/composer-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { ensurePageContent, extractTabContent } from '@/panel/lib/page-extractor';
import { callAI, takePendingAbort } from './stream-controller';
import { removeSuggestions } from './suggest';

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
     click aborts. Keyboard sends (Enter) must never abort — typing ahead is
     normal, so just ignore. */
  if (core.getIsGenerating()) return;

  const composer = useComposerStore.getState();
  const draft = intent.draft ?? composer.getDraftTrimmed();
  const isFreeText = intent.prompt === undefined;
  // A free-text send needs text or images — images alone are a valid message.
  if (isFreeText && !draft && !composer.hasAttachments()) return;

  if (composer.attachmentsTooLarge()) {
    useUIStore.getState().pushToast(t('error.visionPayloadTooLarge'), 'error');
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

  composer.clearDraftText();
  const { imageUris, tabs } = composer.consumeAttachments();
  await sendToAI(text, display, undefined, imageUris, tabs);
}

/** Enter / send button. */
export async function sendMessage(): Promise<void> {
  await submit();
}

export async function sendToAI(
  text: string,
  displayText: string,
  retryQuote?: string,
  imageUris?: string[],
  tabs?: AttachedTab[],
): Promise<void> {
  const startTabId = core.getActiveTabId();
  const tabState = startTabId != null ? core.getStateForTab(startTabId) : null;
  if (!tabState || startTabId == null) return;

  useTabsStore.getState().setGeneratingForTab(startTabId, true);
  useStreamStore.getState().clear(startTabId);
  removeSuggestions(startTabId);

  const quoteForContext = retryQuote || tabState.selectedText;

  const meta: UserMessageMeta = { rawText: text, displayText };
  if (quoteForContext) meta.quote = quoteForContext;
  if (tabs?.length) meta.tabs = tabs.map(({ id, title, url }) => ({ id, title, url }));
  const msgId = genId();

  const hasImages = imageUris !== undefined && imageUris.length > 0;

  // Quote-prefixed API content (the quote also rides in meta for display).
  let apiContent = text;
  if (quoteForContext) {
    const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
    apiContent = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
  }

  let userMessage: ChatMessage;
  if (hasImages) {
    const parts: MessageContentPart[] = [];
    if (apiContent) parts.push({ type: 'text', text: apiContent });
    for (const uri of imageUris!) parts.push({ type: 'image_url', image_url: { url: uri } });
    userMessage = { id: msgId, role: 'user', content: parts, hadImages: true, meta };
  } else {
    userMessage = { id: msgId, role: 'user', content: apiContent, meta };
  }
  // Appended BEFORE extraction: the bubble renders instantly from history,
  // and a failure keeps it visible via the stream entry's failedUserMessage.
  historyOps.appendMessage(tabState, userMessage, startTabId);
  useTabsStore.getState().bump();
  if (quoteForContext) useTabsStore.getState().setSelectedText('');

  try {
    // Ensure the page has been extracted at least once for this tab — the
    // single entry point for extraction; only the pageContent cache decides.
    const extractResult = await ensurePageContent(startTabId);
    if (takePendingAbort(startTabId)) {
      // Stop was pressed while the page was being extracted: nothing was
      // sent — roll the turn back, leave the bubble + a quiet stop note
      // (the stream entry is created here: callAI never ran, so abort()
      // would otherwise no-op and the turn would vanish silently).
      historyOps.rollbackTrailingUserMessage(tabState, startTabId);
      if (!useStreamStore.getState().streams[startTabId]) useStreamStore.getState().start(startTabId);
      useStreamStore.getState().abort(startTabId, t('ai.stopped'));
      useTabsStore.getState().setGeneratingForTab(startTabId, false);
      return;
    }
    if (!extractResult.ok) throw extractResult.error;

    const messages: ChatMessage[] = [];
    const pageContent = tabState.pageContent || '';
    const { citations, agentMode } = await readSettings(['citations', 'agentMode']);
    const lang = getCurrentLang();
    // The rules message is sent whenever there is an article to ground it —
    // or, in agent mode, even without one (see AGENTS.md F11 note).
    if (pageContent || agentMode) {
      const customSystemPrompt = core.getCustomSystemPrompt();
      const customBlock = [
        // The citation rule references [#N] labels — it only makes sense
        // when the labelled article message follows.
        pageContent && citations ? getPrompt('citations.rule', lang) : '',
        agentMode ? getPrompt('agent.rule', lang) : '',
        customSystemPrompt ? getPrompt('default.custom', lang, { custom: customSystemPrompt }) : '',
      ].filter(Boolean).join('\n');
      messages.push({ role: 'system', content: getPrompt('default', lang, { custom: customBlock }) });
    }
    if (pageContent) {
      // Budgeted page context: all paragraphs when they fit, otherwise the
      // opening + the paragraphs relevant to this question.
      const paragraphs = tabState.pageParagraphs?.length ? tabState.pageParagraphs : splitParagraphs(pageContent);
      const page = buildPageContext(paragraphs, [quoteForContext, text].filter(Boolean).join('\n'));
      const context = page.partial ? `${getPrompt('default.partial', lang)}\n\n${page.text}` : page.text;
      // The article is a SEPARATE system message: keeps the custom prompt in
      // a short instruction message the model still attends to.
      messages.push({ role: 'system', content: getPrompt('default.article', lang, { title: tabState.pageTitle, content: context ?? '' }) });
    }

    // F4: other tabs the user attached, each read fresh (they may have changed).
    if (tabs?.length) {
      const blocks = await Promise.all(tabs.map(async (tab) => {
        const r = await extractTabContent(tab.id);
        return r.ok
          ? getPrompt('multitab.tab', lang, { title: r.value.title || tab.title, url: r.value.url || tab.url, content: r.value.textContent })
          : getPrompt('multitab.unreadable', lang, { title: tab.title, url: tab.url });
      }));
      messages.push({ role: 'system', content: getPrompt('multitab.context', lang, { tabs: blocks.join('\n\n') }) });
    }

    // Newest turns within the history budget (the page already has its own).
    // The just-appended user message is EXCLUDED here and pushed explicitly
    // below — otherwise it is sent to the model TWICE (it is already in
    // conversationHistory) and needlessly consumes the trim budget.
    const { messages: recentHistory } = trimHistory((tabState.conversationHistory || []).slice(0, -1));
    messages.push(...recentHistory.map(historyOps.toApiMessage));
    messages.push(historyOps.toApiMessage(userMessage));

    if (hasImages) {
      const totalBytes = imageUris!.reduce((sum, u) => sum + u.length, 0);
      if (totalBytes > MAX_IMAGE_PAYLOAD_BYTES) throw new Error(t('error.visionPayloadTooLarge'));
    }

    await callAI(messages, startTabId, { agent: agentMode === true });
  } catch (e: unknown) {
    takePendingAbort(startTabId); // a Stop racing the failure is moot now
    const errMsg = toErrorMessage(e);
    // Keep the user message visible for retry, but out of history: the
    // controller's fail() records it on the stream entry after rollback.
    // Errors thrown BEFORE callAI (page extraction failure, oversized
    // images) reach this catch with NO stream entry — fail() would no-op
    // and the failure would be completely silent. Ensure the entry exists.
    const hist = tabState.conversationHistory;
    const failedUserMessage = hist.length > 0 && hist[hist.length - 1]!.role === 'user' ? hist[hist.length - 1]! : userMessage;
    historyOps.rollbackTrailingUserMessage(tabState, startTabId);
    if (!useStreamStore.getState().streams[startTabId]) useStreamStore.getState().start(startTabId);
    useStreamStore.getState().fail(startTabId, errMsg, failedUserMessage);
    useTabsStore.getState().setGeneratingForTab(startTabId, false);
  }
}

// --- Retry / edit (data-driven; no DOM teardown) ------------------------------

/**
 * Shared core for retry (resend original) and edit (resend modified).
 * Truncates history at the user message identified by `msgId` (falling back
 * to content matching for id-less legacy messages), keeping what is replaced
 * as a branch, captures the message's images/tabs from history DATA, then
 * re-sends.
 */
async function resendUserMessage(opts: {
  lookupText: string;
  sendText: string;
  sendDisplay: string;
  rawQuote?: string;
  msgId?: string;
  /** Images extracted from the retried message itself — the history entry
   *  may already be gone (failed sends roll back), so the fallback matters. */
  contentImages?: string[];
}): Promise<void> {
  const { lookupText, sendText, sendDisplay, rawQuote, msgId, contentImages } = opts;
  const startTabId = core.getActiveTabId();
  const tabState = startTabId != null ? core.getStateForTab(startTabId) : null;
  if (!tabState || startTabId == null || tabState.isGenerating) return;

  if (tabState.isPodcastGenerating) tabState.isPodcastGenerating = false;
  core.persistForTab(startTabId);

  const userContent = rawQuote
    ? t('ai.quotePrefix') + '\n\n' + safeTruncate(rawQuote, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated')) + '\n\n' + lookupText
    : lookupText;

  // Capture images + tabs from the history entry BEFORE truncating — visual
  // messages keep image_url parts in their content array (data, not DOM).
  // A FAILED send's history entry is already rolled back → fall back to the
  // message's own content parts (the failedUserMessage carries them).
  const retriedImages = extractImagesForRetry(tabState, userContent, msgId) ?? contentImages;
  const retriedTabs = msgId ? tabState.conversationHistory.find(m => m.id === msgId)?.meta?.tabs : undefined;

  // Keep what is being replaced as a branch (‹ n/m › on the new bubble).
  if (msgId) historyOps.branchFromId(tabState, msgId, startTabId);
  else historyOps.truncateHistoryFromUserContent(tabState, userContent, startTabId);
  useTabsStore.getState().bump();

  await sendToAI(sendText, sendDisplay, rawQuote, retriedImages, retriedTabs as AttachedTab[] | undefined);
}

/** Re-send a user message unchanged (its bubble's retry action). */
export async function retryMessage(msg: ChatMessage): Promise<void> {
  const meta = msg.meta;
  await resendUserMessage({
    lookupText: meta?.rawText ?? contentToText(msg),
    sendText: meta?.rawText ?? contentToText(msg),
    sendDisplay: meta?.displayText ?? contentToText(msg),
    rawQuote: meta?.quote,
    msgId: msg.id,
    contentImages: imagesFromContent(msg),
  });
}

/** Edit a user message in place and resend. */
export async function editMessage(msg: ChatMessage, editedText: string): Promise<void> {
  const meta = msg.meta;
  await resendUserMessage({
    lookupText: meta?.rawText ?? contentToText(msg),
    sendText: editedText,
    sendDisplay: editedText,
    rawQuote: meta?.quote,
    msgId: msg.id,
    contentImages: imagesFromContent(msg),
  });
}

/** image_url parts of a message's content (string content → none). */
function imagesFromContent(msg: ChatMessage): string[] | undefined {
  if (typeof msg.content === 'string') return undefined;
  const uris = msg.content.filter(p => p.type === 'image_url').map(p => (p.type === 'image_url' ? p.image_url.url : ''));
  return uris.length ? uris : undefined;
}

function contentToText(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n');
}

/**
 * Find the user message matching `userContent` in history and extract its
 * image_url blocks (re-sends images that were part of the original visual
 * message even though the preview bar is long empty).
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
  const content = hist[idx]!.content;
  if (typeof content === 'string') return undefined;
  const uris = content.filter(p => p.type === 'image_url').map(p => p.type === 'image_url' ? p.image_url.url : '');
  return uris.length ? uris : undefined;
}
