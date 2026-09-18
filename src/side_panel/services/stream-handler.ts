import { t } from '../../shared/i18n.js';
import { openOptionsPage } from '../../platform/messaging';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import { createInnerFollower } from '../ui/auto-scroll';
import {
  appendMessage, addTypingIndicator,
  removeTypingIndicator, smartScrollToBottom,
  setButtonsDisabled,
  addErrorMessageActions, emitRetryFromWrapper, findUserWrapperBefore,
  createToolCard,
} from '../ui/dom-helpers';
import {
  isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay,
} from './tts/index.js';
import { marked } from 'marked';
import type { ChatMessage } from '../../shared/types';
import { appendMessage as appendHistory, rollbackTrailingUserMessage } from './chat/history-ops';

let _chatArea: HTMLElement;

/** Live streams by tab id — lets the stop button abort the active generation. */
const _activeStreams = new Map<number, { port: chrome.runtime.Port; abort: () => void }>();

export function initStreamHandler({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
}

/**
 * Abort the active generation for `tabId`. The port disconnect triggers the
 * graceful onDisconnect path, which (unlike an unexpected disconnect) finalizes
 * the partial answer into history so nothing already streamed is lost.
 */
export function abortGeneration(tabId: number): void {
  _activeStreams.get(tabId)?.abort();
}

export interface CallAIOptions {
  /** Agent mode: the SW attaches enabled tools and may run a multi-step loop. */
  agent?: boolean;
  enabledTools?: string[];
}

export async function callAI(messages: ChatMessage[], tabId: number | null, callOpts?: CallAIOptions): Promise<void> {
  if (isTTSPlaying()) stopTTS();

  const tabState = state.getStateForTab(tabId!);
  if (!tabState) return;

  tabState.isGenerating = true;
  state.persistForTab(tabId!);
  setButtonsDisabled(true);

  if (isTTSAutoPlay()) {
    initTTSPlayback();
  }

  const msgEl = appendMessage('ai', '');
  const typingEl = addTypingIndicator(msgEl);
  let fullText = '';
  let thinkingText = '';
  let thinkingEl: HTMLDetailsElement | null = null;
  let thinkingSummaryEl: HTMLElement | null = null;
  let thinkingContentEl: HTMLDivElement | null = null;
  let thinkingStartedAt: number | null = null;
  let contentEl: HTMLDivElement | null = null;

  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({
    type: 'chat',
    messages: messages,
    ...(callOpts?.agent ? { agent: true, enabledTools: callOpts.enabledTools ?? [] } : {}),
  });

  let userAborted = false;
  _activeStreams.set(tabId!, {
    port,
    abort: () => { userAborted = true; port.disconnect(); },
  });

  function isCurrentTab(): boolean { return state.getActiveTabId() === tabId; }

  // --- Streamed render throttling -------------------------------------------
  // marked.parse over the full accumulated text is O(n); running it once per
  // SSE chunk (10–50/s) makes a long answer O(n²) CPU, plus an innerHTML
  // rebuild and a forced reflow (smartScrollToBottom reads scrollHeight) each
  // time. Chunks buffer into fullText/thinkingText and the DOM is refreshed at
  // most once per interval; `done` always performs a final flush.
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
    contentEl.innerHTML = marked.parse(balanceFences(fullText)) as string;
    /* Always the smart variant: with the stick-to-bottom state machine
       (ui/auto-scroll.ts) there is nothing left to compensate — the old
       forced first-flush scroll existed to recover from scroll-anchoring
       snapping scrollTop off-position when the thinking <details> collapsed,
       and it yanked users who had deliberately scrolled up during thinking
       back to the bottom. Now: stuck users follow the answer from its first
       character; unstuck users keep their reading position. */
    smartScrollToBottom();
  }

  function flushThinking(): void {
    if (!thinkingContentEl || !thinkingContentEl.isConnected) return;
    thinkingContentEl.innerHTML = marked.parse(balanceFences(thinkingText)) as string;
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

  interface StreamMessage {
    type: string;
    content?: string;
    error?: string;
    errorKey?: string;
    /** tool_call / tool_result payloads (agent mode) */
    id?: string;
    name?: string;
    input?: unknown;
    output?: string;
    /** done.messages: the authoritative assistant/tool exchange for persistence */
    messages?: ChatMessage[];
  }

  /** Live tool-call cards by call id — tool_result fills the matching card. */
  const toolCards = new Map<string, ReturnType<typeof createToolCard>>();

  function addToolCard(id: string, name: string, input: unknown): void {
    if (!isCurrentTab() || !msgEl.isConnected) return;
    const card = createToolCard(name, JSON.stringify(input ?? {}));
    toolCards.set(id, card);
    // Cards sit above the streamed answer text, mirroring the live order.
    msgEl.insertBefore(card.el, contentEl ?? null);
    smartScrollToBottom();
  }

  port.onMessage.addListener((msg: StreamMessage) => {
    if (msg.type === 'thinking') {
      thinkingStartedAt ??= performance.now();
      thinkingText += msg.content || '';
      if (isCurrentTab() && msgEl.isConnected) removeTypingIndicator(typingEl);

      if (isCurrentTab() && msgEl.isConnected && !thinkingEl) {
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
        msgEl.appendChild(thinkingEl);
      }

      if (isCurrentTab() && msgEl.isConnected && thinkingContentEl) {
        scheduleFlush();
      }
    } else if (msg.type === 'chunk') {
      if (thinkingStartedAt !== null && thinkingSummaryEl) {
        const elapsedSeconds = (performance.now() - thinkingStartedAt) / 1000;
        thinkingSummaryEl.textContent = `${t('ai.thinking')} · ${elapsedSeconds.toFixed(1)}s`;
        thinkingStartedAt = null;
      }
      if (thinkingEl) thinkingEl.open = false;

      fullText += msg.content || '';
      if (isCurrentTab() && msgEl.isConnected) removeTypingIndicator(typingEl);

      if (isCurrentTab() && msgEl.isConnected && !contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'thinking-response-content';
        msgEl.appendChild(contentEl);
      }

      if (isCurrentTab() && msgEl.isConnected && contentEl) {
        scheduleFlush();
      }
      if (isCurrentTab() && msgEl.isConnected && isTTSAutoPlay()) {
        ttsAppendChunk(msg.content || '');
      }
    } else if (msg.type === 'tool_call') {
      if (isCurrentTab() && msgEl.isConnected) removeTypingIndicator(typingEl);
      addToolCard(msg.id || '', msg.name || 'tool', msg.input);
    } else if (msg.type === 'tool_result') {
      toolCards.get(msg.id || '')?.setOutput(msg.output || '');
    } else if (msg.type === 'done') {
      cancelScheduledFlush();
      flushNow(); // render the complete text before buttons/summary attach
      if (msg.messages && msg.messages.length > 0) {
        // Agent mode: the SW sends the authoritative assistant/tool sequence —
        // persist it verbatim instead of reconstructing from UI events.
        for (const m of msg.messages) appendHistory(tabState, m, tabId!);
      } else {
        appendHistory(tabState, { role: 'assistant', content: fullText }, tabId!);
      }
      tabState.isGenerating = false;
      state.persistForTab(tabId!);
      port.disconnect();

      if (isCurrentTab()) {
        if (!msgEl.isConnected) {
          emit(EVENTS.REQUEST_RERENDER);
          setButtonsDisabled(false);
          const newMsgEl = _chatArea.querySelector('.message-ai:last-of-type') as HTMLElement | null;
          if (newMsgEl) {
            addTTSButton(newMsgEl);
            initTTSAutoPlay();
            emit(EVENTS.GENERATE_SUGGESTIONS, { msgEl: newMsgEl, history: tabState.conversationHistory });
          }
        } else {
          removeTypingIndicator(typingEl);
          if (thinkingEl) thinkingEl.open = false;
          setButtonsDisabled(false);
          addTTSButton(msgEl);
          initTTSAutoPlay();
          emit(EVENTS.GENERATE_SUGGESTIONS, { msgEl, history: tabState.conversationHistory });
          // TTS button + suggestion loading both attach below the answer; keep
          // a stuck view pinned over the newly added chrome.
          smartScrollToBottom();
        }
      }
    } else if (msg.type === 'error') {
      cancelScheduledFlush(); // no pending flush may clobber the error bubble
      rollbackTrailingUserMessage(tabState, tabId!);
      tabState.isGenerating = false;
      state.persistForTab(tabId!);
      port.disconnect();

      if (isCurrentTab()) {
        if (!msgEl.isConnected) {
          emit(EVENTS.REQUEST_RERENDER);
          setButtonsDisabled(false);
        } else {
          removeTypingIndicator(typingEl);
          if (thinkingEl) thinkingEl.open = false;
          const errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || t('error.apiFailed'));
          msgEl.className = 'message message-error';
          msgEl.textContent = errorText;

          // Actionable error: retry re-sends the failed user message; config
          // errors additionally offer a shortcut into the options page.
          const actions = [];
          const wrapper = findUserWrapperBefore(msgEl);
          if (wrapper) actions.push({ label: t('action.retry'), onClick: () => emitRetryFromWrapper(wrapper) });
          if (msg.errorKey === 'error.noApiKey' || msg.errorKey === 'error.noModelName') {
            actions.push({ label: t('action.openSettings'), onClick: () => { openOptionsPage(); } });
          }
          addErrorMessageActions(msgEl, actions);
          setButtonsDisabled(false);
        }
      }
    }
  });

  port.onDisconnect.addListener(() => {
    cancelScheduledFlush();
    _activeStreams.delete(tabId!);
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
        rollbackTrailingUserMessage(tabState, tabId!);
      } else if (userAborted) {
        /* User-requested stop: flush the buffered tail and finalize the partial
           answer into history, so everything already streamed survives tab
           switches and reopens. (An unexpected disconnect intentionally leaves
           history untouched.) */
        flushNow();
        appendHistory(tabState, { role: 'assistant', content: fullText }, tabId!);
        if (isCurrentTab()) {
          if (!msgEl.isConnected) {
            emit(EVENTS.REQUEST_RERENDER);
          } else {
            addTTSButton(msgEl);
          }
        }
        emit(EVENTS.SAVE_CURRENT_CHAT);
      }
      tabState.isGenerating = false;
      state.persistForTab(tabId!);
      if (isCurrentTab()) setButtonsDisabled(false);
    }
  });
}
