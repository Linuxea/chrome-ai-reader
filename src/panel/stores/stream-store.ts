/**
 * Stream store — the live, in-flight answer per tab.
 *
 * React counterpart of the legacy stream-handler's DOM half: there, the
 * streaming answer lived in an appended bubble node kept alive across tab
 * switches by reattachment tricks (msgEl.isConnected, CHAT_RERENDERED).
 * Here the accumulated text/thinking is store state keyed by
 * tab id — switching tabs or re-rendering the list can never lose or
 * duplicate the stream; the MessageList renders it wherever that tab is
 * active, and finalize() folds it into conversationHistory (tabs-store).
 *
 * The port/abort bookkeeping (Outcome, watchdog, reattach registry) lives
 * in `panel/lib/stream-controller.ts` (Phase 2), which writes into this
 * store; nothing here touches chrome.*.
 */
import { create } from 'zustand';
import type { FinishReason, TokenUsage, WebCallEvent } from '@/shared/protocol';
import { genId } from '@/shared/ids';
import type { ChatMessage, WebStep } from '@/shared/types';

/**
 * F15: one web search call as the live trace shows it — `running` from its
 * `call_started` event until its `call_completed` event lands.
 */
export type LiveWebStep = Omit<WebStep, 'status'> & { status: 'running' | WebStep['status'] };

export interface LiveStream {
  tabId: number;
  /** The assistant message id this stream will persist as (TTS anchor). */
  assistantId: string;
  /** Accumulated reasoning text (the thinking block). */
  thinking: string;
  /** Accumulated answer text. */
  answer: string;
  /** F15: server-side web search calls, in the order they started. */
  webSteps: LiveWebStep[];
  status: 'streaming' | 'done' | 'error' | 'aborted';
  finishReason?: FinishReason;
  usage?: TokenUsage;
  model?: string;
  error?: string;
  /** i18n key of the error (config errors key the settings shortcut). */
  errorKey?: string;
  /** A quiet "stopped" note rendered after an empty-answer abort. */
  note?: string;
  /**
   * A send that failed before the model answered: the user message was
   * rolled back from history (so the next send starts clean) but stays
   * visible here with its retry affordance — the data equivalent of the
   * legacy "keep the bubble, roll back the history" behavior. Also set on
   * an empty-answer abort (stop before the first token).
   */
  failedUserMessage?: ChatMessage;
}

interface StreamStore {
  streams: Record<number, LiveStream | undefined>;

  /** Begin (or restart) a stream for a tab — resets all accumulated state. */
  start: (tabId: number) => string;
  appendThinking: (tabId: number, text: string) => void;
  appendAnswer: (tabId: number, text: string) => void;
  /**
   * F15: apply one web search event to the live trace. `call_started` appends
   * a running step; `call_completed` fills in the step with that call id —
   * completions arrive out of order, so they are matched by id, never
   * appended. A completion whose start was never seen is ignored.
   */
  addSearchEvent: (tabId: number, event: WebCallEvent) => void;
  /**
   * The worker restarted the request (`retry` on the port): forget what the
   * dead attempt streamed — reasoning, text and search events — and keep the
   * entry (same assistant id, still streaming). No answer text exists at that
   * point, by the worker's contract.
   */
  restart: (tabId: number) => void;
  /** Normal end: keep the accumulated text visible until folded into history. */
  finish: (tabId: number, outcome: { finishReason?: FinishReason; usage?: TokenUsage; model?: string }) => void;
  /** Abnormal end (port error / provider error). Keeps the failed user message for retry. */
  fail: (tabId: number, error: string, failedUserMessage?: ChatMessage, errorKey?: string) => void;
  /** User stopped before any answer text — keep the user turn retryable + a quiet note. */
  abort: (tabId: number, note: string, failedUserMessage?: ChatMessage) => void;
  /** Drop the entry — after its content was folded into history or rolled back. */
  clear: (tabId: number) => void;
}

export const useStreamStore = create<StreamStore>()(set => ({
  streams: {},

  start: tabId => {
    const assistantId = genId();
    set(s => ({
      streams: { ...s.streams, [tabId]: { tabId, assistantId, thinking: '', answer: '', webSteps: [], status: 'streaming' } },
    }));
    return assistantId;
  },

  appendThinking: (tabId, text) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, thinking: cur.thinking + text } } };
    }),

  appendAnswer: (tabId, text) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, answer: cur.answer + text } } };
    }),

  addSearchEvent: (tabId, event) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      const steps = cur.webSteps.slice();
      const at = steps.findIndex(step => step.id === event.call.id);
      if (event.type === 'call_started') {
        if (at !== -1) return s;
        const { id, kind, action } = event.call;
        steps.push({ id, kind, action, status: 'running' });
      } else {
        if (at === -1) return s;
        const { status, sources, page, error } = event.call;
        steps[at] = { ...steps[at]!, status, ...(sources ? { sources } : {}), ...(page ? { page } : {}), ...(error ? { error } : {}) };
      }
      return { streams: { ...s.streams, [tabId]: { ...cur, webSteps: steps } } };
    }),

  restart: tabId =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, thinking: '', answer: '', webSteps: [] } } };
    }),

  finish: (tabId, outcome) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return {
        streams: {
          ...s.streams,
          [tabId]: { ...cur, status: 'done', finishReason: outcome.finishReason, usage: outcome.usage, model: outcome.model },
        },
      };
    }),

  fail: (tabId, error, failedUserMessage, errorKey) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, status: 'error', error, errorKey, failedUserMessage } } };
    }),

  abort: (tabId, note, failedUserMessage) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, status: 'aborted', note, failedUserMessage } } };
    }),

  clear: tabId =>
    set(s => {
      if (!(tabId in s.streams)) return s;
      const streams = { ...s.streams };
      delete streams[tabId];
      return { streams };
    }),
}));
