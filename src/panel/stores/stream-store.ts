/**
 * Stream store — the live, in-flight answer per tab.
 *
 * React counterpart of the legacy stream-handler's DOM half: there, the
 * streaming answer lived in an appended bubble node kept alive across tab
 * switches by reattachment tricks (msgEl.isConnected, CHAT_RERENDERED).
 * Here the accumulated text/thinking/agent rounds are store state keyed by
 * tab id — switching tabs or re-rendering the list can never lose or
 * duplicate the stream; the MessageList renders it wherever that tab is
 * active, and finalize() folds it into conversationHistory (tabs-store).
 *
 * The port/abort bookkeeping (Outcome, watchdog, reattach registry) lives
 * in `panel/lib/stream-controller.ts` (Phase 2), which writes into this
 * store; nothing here touches chrome.*.
 */
import { create } from 'zustand';
import type { FinishReason, TokenUsage } from '@/shared/protocol';
import { genId } from '@/shared/ids';
import type { ChatMessage, ToolCall } from '@/shared/types';

export interface AgentRound {
  /** 1-based round index (matches the `agent_round` wire message). */
  round: number;
  calls: (ToolCall & { result?: string })[];
}

export interface LiveStream {
  tabId: number;
  /** The assistant message id this stream will persist as (TTS anchor). */
  assistantId: string;
  /** Accumulated reasoning text (the thinking block). */
  thinking: string;
  /** Accumulated answer text. */
  answer: string;
  /** Agent-mode tool rounds, in order. */
  rounds: AgentRound[];
  status: 'streaming' | 'done' | 'error' | 'aborted';
  finishReason?: FinishReason;
  /** `limit:'steps'` qualifies finishReason 'length' as the agent round cap. */
  limit?: 'steps';
  usage?: TokenUsage;
  model?: string;
  error?: string;
  /** A quiet "stopped" note rendered after an empty-answer abort. */
  note?: string;
  /**
   * A send that failed before the model answered: the user message was
   * rolled back from history (so the next send starts clean) but stays
   * visible here with its retry affordance — the data equivalent of the
   * legacy "keep the bubble, roll back the history" behavior.
   */
  failedUserMessage?: ChatMessage;
}

interface StreamStore {
  streams: Record<number, LiveStream | undefined>;

  /** Begin (or restart) a stream for a tab — resets all accumulated state. */
  start: (tabId: number) => string;
  appendThinking: (tabId: number, text: string) => void;
  appendAnswer: (tabId: number, text: string) => void;
  /** A new agent round starts (1-based); ignored if that round already exists. */
  startRound: (tabId: number, round: number) => void;
  addToolCall: (tabId: number, call: ToolCall) => void;
  /** Attach a finished tool execution's excerpt to its live step line. */
  setToolResult: (tabId: number, callId: string, result: string) => void;
  /** Normal end: keep the accumulated text visible until folded into history. */
  finish: (tabId: number, outcome: { finishReason?: FinishReason; usage?: TokenUsage; model?: string; limit?: 'steps' }) => void;
  /** Abnormal end (port error / provider error). Keeps the failed user message for retry. */
  fail: (tabId: number, error: string, failedUserMessage?: ChatMessage) => void;
  /** User stopped before any answer text — render as a quiet note. */
  abort: (tabId: number, note: string) => void;
  /** Drop the entry — after its content was folded into history or rolled back. */
  clear: (tabId: number) => void;
}

export const useStreamStore = create<StreamStore>()(set => ({
  streams: {},

  start: tabId => {
    const assistantId = genId();
    set(s => ({
      streams: { ...s.streams, [tabId]: { tabId, assistantId, thinking: '', answer: '', rounds: [], status: 'streaming' } },
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

  startRound: (tabId, round) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      if (cur.rounds.some(r => r.round === round)) return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, rounds: [...cur.rounds, { round, calls: [] }] } } };
    }),

  addToolCall: (tabId, call) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming' || cur.rounds.length === 0) return s;
      const rounds = cur.rounds.slice();
      const last = rounds[rounds.length - 1]!;
      rounds[rounds.length - 1] = { ...last, calls: [...last.calls, { ...call }] };
      return { streams: { ...s.streams, [tabId]: { ...cur, rounds } } };
    }),

  setToolResult: (tabId, callId, result) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur) return s;
      let found = false;
      const rounds = cur.rounds.map(r => ({
        ...r,
        calls: r.calls.map(c => {
          if (c.id !== callId || c.result !== undefined) return c;
          found = true;
          return { ...c, result };
        }),
      }));
      if (!found) return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, rounds } } };
    }),

  finish: (tabId, outcome) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return {
        streams: {
          ...s.streams,
          [tabId]: { ...cur, status: 'done', finishReason: outcome.finishReason, usage: outcome.usage, model: outcome.model, limit: outcome.limit },
        },
      };
    }),

  fail: (tabId, error, failedUserMessage) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, status: 'error', error, failedUserMessage } } };
    }),

  abort: (tabId, note) =>
    set(s => {
      const cur = s.streams[tabId];
      if (!cur || cur.status !== 'streaming') return s;
      return { streams: { ...s.streams, [tabId]: { ...cur, status: 'aborted', note } } };
    }),

  clear: tabId =>
    set(s => {
      if (!(tabId in s.streams)) return s;
      const streams = { ...s.streams };
      delete streams[tabId];
      return { streams };
    }),
}));
