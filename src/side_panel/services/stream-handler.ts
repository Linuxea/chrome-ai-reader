import { t } from '../../shared/i18n.js';
import { openOptionsPage } from '../../platform/messaging';
import * as state from '../state';
import { on, emit, EVENTS } from '../events';
import { createInnerFollower } from '../ui/auto-scroll';
import {
  appendMessage, appendMessageFromHistory, appendErrorMessage, addTypingIndicator,
  removeTypingIndicator, smartScrollToBottom, scrollToBottom,
  setButtonsDisabled,
  addErrorMessageActions, emitRetryFromWrapper, findUserWrapperBefore, createNoteElement as noteEl,
  type ErrorMessageAction,
} from '../ui/dom-helpers';
import {
  isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay,
} from './tts/index.js';
import { renderMarkdown } from '../ui/markdown';
import { genId } from '../../shared/ids';
import type { ChatMessage } from '../../shared/types';
import type { StreamMessage, FinishReason, TokenUsage } from '../../shared/protocol';
import { appendMessage as appendHistory, rollbackTrailingUserMessage } from './chat/history-ops';
import { openAIChatPort } from '../../platform/ports';

let _chatArea: HTMLElement;
let _unsubscribeRerender: (() => void) | null = null;

/** Live streams by tab id — the stop button aborts, a re-render re-attaches. */
const _activeStreams = new Map<number, { abort: () => void; reattach: () => void }>();

/** Answers that finished while their tab was in the background — saved to chat history on return. */
const _pendingSaves = new Set<number>();

/** Failures that happened while their tab was in the background — shown on return. */
const _pendingErrors = new Map<number, { userMessage: ChatMessage | null; errorText: string; errorKey?: string }>();

export function initStreamHandler({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
  _unsubscribeRerender?.();
  _unsubscribeRerender = on(EVENTS.CHAT_RERENDERED, onChatRerendered);
}

/**
 * The chat area was just rebuilt from history (tab switch / re-render). Bring
 * back whatever the active tab's stream has to show: the in-flight answer
 * bubble, or the outcome of a stream that ended while the tab was hidden.
 */
function onChatRerendered(): void {
  const tabId = state.getActiveTabId();
  if (tabId == null) return;

  _activeStreams.get(tabId)?.reattach();

  const pendingError = _pendingErrors.get(tabId);
  if (pendingError) {
    _pendingErrors.delete(tabId);
    // The failed user message was rolled back from history; re-show it so
    // the typed text is not lost and retry has something to re-send.
    const userEl = pendingError.userMessage ? appendMessageFromHistory(pendingError.userMessage) : null;
    const wrapper = userEl?.closest('.user-msg-group') as HTMLElement | null;
    appendErrorMessage(pendingError.errorText, errorActions(wrapper ?? null, pendingError.errorKey));
  }

  if (_pendingSaves.delete(tabId)) emit(EVENTS.SAVE_CURRENT_CHAT);
}

/** Retry (re-send the failed user message) + a settings shortcut for config errors. */
function errorActions(wrapper: HTMLElement | null, errorKey?: string): ErrorMessageAction[] {
  const actions: ErrorMessageAction[] = [];
  if (wrapper) actions.push({ label: t('action.retry'), onClick: () => emitRetryFromWrapper(wrapper) });
  if (errorKey === 'error.noApiKey' || errorKey === 'error.noModelName') {
    actions.push({ label: t('action.openSettings'), onClick: () => { openOptionsPage(); } });
  }
  return actions;
}

/**
 * Abort the active generation for `tabId`. Finalizes directly: a port's own
 * onDisconnect does not fire for a disconnect() it initiated (only the service
 * worker's end sees it), so the panel must not wait for that event.
 */
export function abortGeneration(tabId: number): void {
  const stream = _activeStreams.get(tabId);
  if (stream) {
    stream.abort();
  } else if (state.getStateForTab(tabId)?.isGenerating) {
    // Stop pressed before the stream opened (page extraction still running):
    // sendToAI checks this once extraction returns and cancels the send.
    _pendingAborts.add(tabId);
  }
}

/** Stops requested before a stream existed, by tab id. */
const _pendingAborts = new Set<number>();

/** Consume a Stop that was pressed before the stream opened. */
export function takePendingAbort(tabId: number): boolean {
  return _pendingAborts.delete(tabId);
}

type Outcome =
  | { kind: 'done'; finishReason?: FinishReason; usage?: TokenUsage; model?: string }
  | { kind: 'error'; errorText: string; errorKey?: string }
  | { kind: 'aborted' }
  /** The service worker's end went away (worker restart / crash). */
  | { kind: 'disconnected' };

export async function callAI(messages: ChatMessage[], tabId: number | null): Promise<void> {
  if (isTTSPlaying()) stopTTS();

  const tabState = state.getStateForTab(tabId!);
  if (!tabState) return;

  state.setGeneratingForTab(tabId!, true);
  setButtonsDisabled(true);

  if (isTTSAutoPlay()) {
    initTTSPlayback();
  }

  // The answer bubble is built even while detached (tab in the background):
  // DOM nodes are cheap, and only the markdown flush is skipped until the
  // bubble is re-attached.
  const msgEl = appendMessage('ai', '');
  const typingEl = addTypingIndicator(msgEl);
  let fullText = '';
  let thinkingText = '';
  let thinkingEl: HTMLDetailsElement | null = null;
  let thinkingSummaryEl: HTMLElement | null = null;
  let thinkingContentEl: HTMLDivElement | null = null;
  let thinkingStartedAt: number | null = null;
  let contentEl: HTMLDivElement | null = null;
  let finished = false;

  const port = openAIChatPort();

  port.postMessage({
    type: 'chat',
    messages: messages,
  });

  _activeStreams.set(tabId!, {
    abort: () => finalize({ kind: 'aborted' }),
    reattach,
  });

  function isCurrentTab(): boolean { return state.getActiveTabId() === tabId; }

  // --- Streamed render throttling -------------------------------------------
  // marked.parse over the full accumulated text is O(n); running it once per
  // SSE chunk (10–50/s) makes a long answer O(n²) CPU, plus an innerHTML
  // rebuild and a forced reflow (smartScrollToBottom reads scrollHeight) each
  // time. Chunks buffer into fullText/thinkingText and the DOM is refreshed at
  // most once per interval; the end of the stream always performs a final flush.
  const STREAM_FLUSH_INTERVAL_MS = 80;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  let followThinking: (() => void) | null = null;

  /** Close an unterminated ``` fence so partially streamed code blocks render stably. */
  function balanceFences(text: string): string {
    const fenceCount = text.match(/^\s{0,3}```/gm)?.length ?? 0;
    return fenceCount % 2 === 1 ? text + '\n```' : text;
  }

  function flushContent(): void {
    if (!contentEl || !contentEl.isConnected) return;
    contentEl.innerHTML = renderMarkdown(balanceFences(fullText));
    /* Always the smart variant: with the stick-to-bottom state machine
       (ui/auto-scroll.ts) stuck users follow the answer from its first
       character; unstuck users keep their reading position. */
    smartScrollToBottom();
  }

  function flushThinking(): void {
    if (!thinkingContentEl || !thinkingContentEl.isConnected) return;
    thinkingContentEl.innerHTML = renderMarkdown(balanceFences(thinkingText));
    followThinking?.();
    smartScrollToBottom();
  }

  function flushNow(): void {
    lastFlushAt = performance.now();
    if (thinkingEl && thinkingEl.open) flushThinking();
    if (contentEl) flushContent();
  }

  function cancelScheduledFlush(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function scheduleFlush(): void {
    // Hidden tab / detached bubble: reattach() flushes everything at once.
    if (!msgEl.isConnected || !isCurrentTab()) return;
    if (flushTimer !== null) return; // pending timer picks up the buffered text
    const elapsed = performance.now() - lastFlushAt;
    if (elapsed >= STREAM_FLUSH_INTERVAL_MS) {
      flushNow();
    } else {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushNow();
      }, STREAM_FLUSH_INTERVAL_MS - elapsed);
    }
  }

  function ensureThinkingEl(): void {
    if (thinkingEl) return;
    thinkingEl = document.createElement('details');
    thinkingEl.className = 'thinking-block';
    thinkingEl.open = true;
    const summary = document.createElement('summary');
    summary.className = 'thinking-summary';
    summary.textContent = t('ai.thinking');
    thinkingSummaryEl = summary;
    thinkingEl.appendChild(summary);
    thinkingContentEl = document.createElement('div');
    thinkingContentEl.className = 'thinking-content';
    thinkingEl.appendChild(thinkingContentEl);
    followThinking = createInnerFollower(thinkingContentEl);
    // Collapsed thinking isn't flushed while streaming; render the latest
    // reasoning whenever the user expands it.
    thinkingEl.addEventListener('toggle', () => { if (thinkingEl?.open) flushThinking(); });
    msgEl.appendChild(thinkingEl);
  }

  function ensureContentEl(): void {
    if (contentEl) return;
    contentEl = document.createElement('div');
    contentEl.className = 'thinking-response-content';
    msgEl.appendChild(contentEl);
  }

  /** The tab became active again and its chat area was rebuilt: put the live bubble back. */
  function reattach(): void {
    if (finished || msgEl.isConnected || !isCurrentTab()) return;
    _chatArea.appendChild(msgEl);
    flushNow();
    scrollToBottom();
  }

  port.onMessage.addListener((msg: StreamMessage) => {
    if (finished) return;
    if (msg.type === 'thinking') {
      thinkingStartedAt ??= performance.now();
      thinkingText += msg.content || '';
      removeTypingIndicator(typingEl);
      ensureThinkingEl();
      scheduleFlush();
    } else if (msg.type === 'chunk') {
      const firstChunk = fullText === '';
      fullText += msg.content || '';
      removeTypingIndicator(typingEl);

      if (firstChunk) {
        // The answer started: stamp the thinking duration and collapse the
        // reasoning ONCE — the user may re-open it while the answer streams.
        if (thinkingStartedAt !== null && thinkingSummaryEl) {
          const elapsedSeconds = (performance.now() - thinkingStartedAt) / 1000;
          thinkingSummaryEl.textContent = `${t('ai.thinking')} · ${elapsedSeconds.toFixed(1)}s`;
          thinkingStartedAt = null;
        }
        if (thinkingEl) thinkingEl.open = false;
      }

      ensureContentEl();
      scheduleFlush();
      if (isCurrentTab() && msgEl.isConnected && isTTSAutoPlay()) {
        ttsAppendChunk(msg.content || '');
      }
    } else if (msg.type === 'done') {
      finalize({ kind: 'done', finishReason: msg.finishReason, usage: msg.usage, model: msg.model });
    } else if (msg.type === 'error') {
      finalize({
        kind: 'error',
        errorText: msg.errorKey ? t(msg.errorKey) : (msg.error || t('error.apiFailed')),
        errorKey: msg.errorKey,
      });
    }
  });

  // Fires only when the service worker's end goes away — never for our own
  // disconnect() (see abortGeneration).
  port.onDisconnect.addListener(() => finalize({ kind: 'disconnected' }));

  /**
   * The single end-of-stream path (done / error / user stop / worker gone).
   * Idempotent: whichever outcome arrives first wins.
   */
  function finalize(outcome: Outcome): void {
    if (finished) return;
    finished = true;
    cancelScheduledFlush();
    _activeStreams.delete(tabId!);
    try { port.disconnect(); } catch { /* already disconnected */ }
    removeTypingIndicator(typingEl);

    // A disconnect / stop that already produced text keeps the partial answer
    // (so nothing streamed is lost); one that produced nothing is a failure
    // (disconnect) or a silent no-op (stop).
    // A refusal with nothing written is an error the user should see, not an empty answer.
    if (outcome.kind === 'done' && outcome.finishReason === 'refusal' && fullText === '') {
      outcome = { kind: 'error', errorText: t('error.refused'), errorKey: 'error.refused' };
    }
    const keepsAnswer = outcome.kind === 'done' || (fullText !== '' && (outcome.kind === 'aborted' || outcome.kind === 'disconnected'));

    if (keepsAnswer) {
      appendHistory(tabState!, { id: genId(), role: 'assistant', content: fullText }, tabId!);
      state.setGeneratingForTab(tabId!, false);
      finishAnswer(outcome.kind === 'done');
      if (outcome.kind === 'done' && isCurrentTab()) annotateAnswer(outcome);
      return;
    }

    if (outcome.kind === 'aborted') {
      // Stopped before any answer text: drop the unanswered turn from history
      // (the user bubble stays, with its retry button) and leave a quiet note.
      rollbackTrailingUserMessage(tabState!, tabId!);
      state.setGeneratingForTab(tabId!, false);
      msgEl.className = 'message message-note';
      msgEl.textContent = t('ai.stopped');
      if (isCurrentTab()) setButtonsDisabled(false);
      return;
    }

    const errorText = outcome.kind === 'error' ? outcome.errorText : t('error.apiFailed');
    const errorKey = outcome.kind === 'error' ? outcome.errorKey : undefined;
    const hist = tabState!.conversationHistory;
    const failedUserMessage = hist.length > 0 && hist[hist.length - 1].role === 'user' ? hist[hist.length - 1] : null;
    rollbackTrailingUserMessage(tabState!, tabId!);
    state.setGeneratingForTab(tabId!, false);

    if (isCurrentTab() && msgEl.isConnected) {
      if (thinkingEl) thinkingEl.open = false;
      msgEl.className = 'message message-error';
      msgEl.textContent = errorText;
      addErrorMessageActions(msgEl, errorActions(findUserWrapperBefore(msgEl), errorKey));
      setButtonsDisabled(false);
    } else {
      // Hidden tab: surface the failure (and the failed message) on return.
      _pendingErrors.set(tabId!, { userMessage: failedUserMessage, errorText, errorKey });
      if (isCurrentTab()) {
        setButtonsDisabled(false);
        emit(EVENTS.REQUEST_RERENDER);
      }
    }
  }

  /** Truncation / refusal notes and the token-usage footer under a finished answer. */
  function annotateAnswer(outcome: { finishReason?: FinishReason; usage?: TokenUsage; model?: string }): void {
    if (!msgEl.isConnected) return;
    if (outcome.finishReason === 'length') msgEl.after(noteEl(t('ai.truncatedByLimit')));
    else if (outcome.finishReason === 'refusal') msgEl.after(noteEl(t('ai.refusedPartway')));
    if (outcome.usage) {
      const meta = document.createElement('div');
      meta.className = 'answer-usage';
      meta.textContent = t('ai.usage', {
        model: outcome.model ?? '',
        in: String(outcome.usage.inputTokens),
        out: String(outcome.usage.outputTokens),
      });
      msgEl.appendChild(meta);
    }
  }

  /** Answer kept (complete, or partial after stop / disconnect): attach its controls, save it. */
  function finishAnswer(complete: boolean): void {
    if (!isCurrentTab()) {
      // Rendered from history when the user returns; save the chat then.
      _pendingSaves.add(tabId!);
      return;
    }
    msgEl.dataset.markdown = fullText; // copy button copies the markdown source
    let answerEl: HTMLElement | null = msgEl;
    if (!msgEl.isConnected) {
      emit(EVENTS.REQUEST_RERENDER);
      const answers = _chatArea.querySelectorAll<HTMLElement>('.message-ai');
      answerEl = answers[answers.length - 1] ?? null;
    } else {
      flushNow(); // render the complete text before buttons/summary attach
      if (thinkingEl) thinkingEl.open = false;
      addTTSButton(msgEl);
    }
    setButtonsDisabled(false);
    if (!answerEl) return;
    if (complete) {
      initTTSAutoPlay(answerEl);
      // Suggestions attach below the answer; this also saves the chat.
      emit(EVENTS.GENERATE_SUGGESTIONS, { msgEl: answerEl, history: tabState!.conversationHistory });
    } else {
      emit(EVENTS.SAVE_CURRENT_CHAT);
    }
    // TTS button + suggestion loading attach below the answer; keep a stuck
    // view pinned over the newly added chrome.
    smartScrollToBottom();
  }
}
