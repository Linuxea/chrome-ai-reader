/**
 * The live view of one streamed answer: a collapsible reasoning block and
 * the Markdown answer, rendered with throttling.
 *
 * Extracted from stream-handler's callAI, which mixed this rendering with
 * the stream protocol, history, TTS and tab switching. The view knows
 * nothing about ports or state; the caller feeds it text and tells it when
 * rendering is possible (bubble attached, its tab active).
 *
 * Throttling: marked over the full accumulated text is O(n); running it for
 * every SSE chunk (10–50/s) makes a long answer O(n²) CPU plus a reflow per
 * chunk. Text buffers and the DOM refreshes at most every FLUSH_INTERVAL_MS;
 * `flushNow()` renders everything (end of stream, re-attach).
 */

import { t } from '../../shared/i18n.js';
import { renderMarkdown } from './markdown';
import { createInnerFollower } from './auto-scroll';
import { smartScrollToBottom } from './dom-helpers';
import { linkifyCitations } from './citations';

export const FLUSH_INTERVAL_MS = 80;

/** Close an unterminated ``` fence so partially streamed code blocks render stably. */
export function balanceFences(text: string): string {
  const fenceCount = text.match(/^\s{0,3}```/gm)?.length ?? 0;
  return fenceCount % 2 === 1 ? text + '\n```' : text;
}

export interface AnswerView {
  /** Accumulated answer / reasoning text. */
  readonly text: string;
  readonly thinking: string;
  appendThinking(delta: string): void;
  appendText(delta: string): void;
  /** Render all buffered text now (cancels a pending throttled flush). */
  flushNow(): void;
  cancelFlush(): void;
  collapseThinking(): void;
}

export function createAnswerView(msgEl: HTMLElement, canRender: () => boolean): AnswerView {
  let text = '';
  let thinking = '';
  let thinkingEl: HTMLDetailsElement | null = null;
  let thinkingSummaryEl: HTMLElement | null = null;
  let thinkingContentEl: HTMLDivElement | null = null;
  let thinkingStartedAt: number | null = null;
  let contentEl: HTMLDivElement | null = null;
  let followThinking: (() => void) | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;

  function flushContent(): void {
    if (!contentEl || !contentEl.isConnected) return;
    contentEl.innerHTML = renderMarkdown(balanceFences(text));
    linkifyCitations(contentEl);
    /* Always the smart variant: stuck users follow the answer from its first
       character; unstuck users keep their reading position. */
    smartScrollToBottom();
  }

  function flushThinking(): void {
    if (!thinkingContentEl || !thinkingContentEl.isConnected) return;
    thinkingContentEl.innerHTML = renderMarkdown(balanceFences(thinking));
    followThinking?.();
    smartScrollToBottom();
  }

  function flushNow(): void {
    lastFlushAt = performance.now();
    if (thinkingEl && thinkingEl.open) flushThinking();
    if (contentEl) flushContent();
  }

  function cancelFlush(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function scheduleFlush(): void {
    // Hidden tab / detached bubble: the caller flushes once on re-attach.
    if (!msgEl.isConnected || !canRender()) return;
    if (flushTimer !== null) return; // the pending timer picks up the buffer
    const elapsed = performance.now() - lastFlushAt;
    if (elapsed >= FLUSH_INTERVAL_MS) {
      flushNow();
    } else {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushNow();
      }, FLUSH_INTERVAL_MS - elapsed);
    }
  }

  function ensureThinkingEl(): void {
    if (thinkingEl) return;
    const details = document.createElement('details');
    details.className = 'thinking-block';
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'thinking-summary';
    summary.textContent = t('ai.thinking');
    thinkingSummaryEl = summary;
    details.appendChild(summary);
    thinkingContentEl = document.createElement('div');
    thinkingContentEl.className = 'thinking-content';
    details.appendChild(thinkingContentEl);
    followThinking = createInnerFollower(thinkingContentEl);
    // Collapsed thinking isn't flushed while streaming; render the latest
    // reasoning whenever the user expands it.
    details.addEventListener('toggle', () => { if (details.open) flushThinking(); });
    thinkingEl = details;
    msgEl.appendChild(details);
  }

  function ensureContentEl(): void {
    if (contentEl) return;
    contentEl = document.createElement('div');
    contentEl.className = 'thinking-response-content';
    msgEl.appendChild(contentEl);
  }

  return {
    get text() { return text; },
    get thinking() { return thinking; },
    appendThinking(delta: string): void {
      thinkingStartedAt ??= performance.now();
      thinking += delta;
      ensureThinkingEl();
      scheduleFlush();
    },
    appendText(delta: string): void {
      if (text === '') {
        // The answer started: stamp the thinking duration and collapse the
        // reasoning ONCE — the user may re-open it while the answer streams.
        if (thinkingStartedAt !== null && thinkingSummaryEl) {
          const elapsedSeconds = (performance.now() - thinkingStartedAt) / 1000;
          thinkingSummaryEl.textContent = `${t('ai.thinking')} · ${elapsedSeconds.toFixed(1)}s`;
          thinkingStartedAt = null;
        }
        if (thinkingEl) thinkingEl.open = false;
      }
      text += delta;
      ensureContentEl();
      scheduleFlush();
    },
    flushNow,
    cancelFlush,
    collapseThinking(): void {
      if (thinkingEl) thinkingEl.open = false;
    },
  };
}
