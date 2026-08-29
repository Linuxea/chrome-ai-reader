import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import {
  appendMessage, addTypingIndicator,
  removeTypingIndicator, scrollToBottom, smartScrollToBottom,
  setButtonsDisabled,
} from '../ui/dom-helpers';
import {
  isTTSPlaying, stopTTS, initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay,
} from './tts/index.js';
import { marked } from 'marked';
import type { ChatMessage } from '../../shared/types';
import { appendMessage as appendHistory, rollbackTrailingUserMessage } from './chat/history-ops';

let _chatArea: HTMLElement;

export function initStreamHandler({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
}

export async function callAI(messages: ChatMessage[], tabId: number | null): Promise<void> {
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
  let contentFlushCount = 0;

  /** Close an unterminated ``` fence so partially streamed code blocks render stably. */
  function balanceFences(text: string): string {
    const fenceCount = text.match(/^\s{0,3}```/gm)?.length ?? 0;
    return fenceCount % 2 === 1 ? text + '\n```' : text;
  }

  function flushContent(): void {
    if (!contentEl || !contentEl.isConnected) return;
    contentEl.innerHTML = marked.parse(balanceFences(fullText)) as string;
    /* Force-scroll on the first answer flush: the thinking <details> just
       got collapsed above, which (together with overflow-anchor) is the
       exact trigger for the scroll-stops-following bug. Even with
       overflow-anchor:none, pinning scrollTop to the bottom at the
       thinking→answer handoff guarantees the view starts tracking the
       answer from its first character. Subsequent flushes use the
       smart variant so users can scroll up to read without fighting it. */
    if (contentFlushCount === 0) scrollToBottom();
    else smartScrollToBottom();
    contentFlushCount++;
  }

  function flushThinking(): void {
    if (!thinkingContentEl || !thinkingContentEl.isConnected) return;
    thinkingContentEl.innerHTML = marked.parse(balanceFences(thinkingText)) as string;
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
    } else if (msg.type === 'done') {
      cancelScheduledFlush();
      flushNow(); // render the complete text before buttons/summary attach
      appendHistory(tabState, { role: 'assistant', content: fullText }, tabId!);
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
          const errorText = msg.errorKey ? t(msg.errorKey) : escapeHtml(msg.error || '')!;
          msgEl.className = 'message message-error';
          msgEl.textContent = errorText;
          setButtonsDisabled(false);
        }
      }
    }
  });

  port.onDisconnect.addListener(() => {
    cancelScheduledFlush();
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
      }
      tabState.isGenerating = false;
      state.persistForTab(tabId!);
      if (isCurrentTab()) setButtonsDisabled(false);
    }
  });
}
