/**
 * Stream controller — the protocol half of the legacy stream-handler,
 * ported to write into stores instead of the DOM.
 *
 * What was kept verbatim (hard-won semantics):
 * - The single idempotent `finalize()` for every end-of-stream path (done /
 *   error / user stop / worker gone) — whichever arrives first wins.
 * - A disconnect/stop that already produced text keeps the partial answer;
 *   one that produced nothing is a failure (disconnect) or a quiet no-op
 *   (stop) that rolls the unanswered user turn back out of history.
 * - A refusal with no text is surfaced as an error, not an empty answer.
 * - Agent tool calls run in the panel (they need TabState) and answer on
 *   the same port; the trace is flushed in CALL order even when tools
 *   finish out of order (arrival-order queue behind a done map).
 * - Stop pressed before the port opened (during page extraction) is a
 *   pending abort consumed by the send pipeline.
 *
 * What replaced the legacy DOM tricks: the live answer lives in
 * stream-store keyed by tab id, so "reattach after re-render" and
 * "_pendingSaves/_pendingErrors for hidden tabs" are simply unnecessary —
 * rendering is derived from state for whichever tab is active.
 */
import { t } from '@/shared/i18n.js';
import type { AgentTraceStep, ChatMessage, ToolCall } from '@/shared/types';
import type { StreamMessage, FinishReason, TokenUsage } from '@/shared/protocol';
import { openAIChatPort } from '@/platform/ports';
import { AGENT_TOOL_SPECS, runAgentTool } from '@/panel/lib/agent-tools';
import * as historyOps from '@/panel/lib/history-ops';
import { useStreamStore } from '@/panel/stores/stream-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import * as core from '@/panel/state';
import { ttsAutoplayStart, ttsAutoplayChunk, ttsAutoplayFinish } from './tts-controller';
import { saveCurrentChat } from './chat-save';
import { generateSuggestionsFor } from './suggest';

type Outcome =
  | { kind: 'done'; finishReason?: FinishReason; usage?: TokenUsage; model?: string; limit?: 'steps' }
  | { kind: 'error'; errorText: string; errorKey?: string }
  | { kind: 'aborted' }
  /** The service worker's end went away (worker restart / crash). */
  | { kind: 'disconnected' };

/** Live streams by tab id — the stop button aborts the active one. */
const _activeStreams = new Map<number, { abort: () => void }>();

/** Stops requested before a stream existed (page extraction still running). */
const _pendingAborts = new Set<number>();

export interface CallAIOptions {
  /** Agent mode: offer the panel's tools; the worker loops until an answer. */
  agent?: boolean;
}

/**
 * Abort the active generation for `tabId`. Finalizes directly: a port's own
 * onDisconnect does not fire for a disconnect() it initiated (only the
 * service worker's end sees it), so the panel must not wait for that event.
 */
export function abortGeneration(tabId: number): void {
  const stream = _activeStreams.get(tabId);
  if (stream) {
    stream.abort();
  } else if (core.getStateForTab(tabId)?.isGenerating) {
    _pendingAborts.add(tabId);
  }
}

/** Consume a Stop that was pressed before the stream opened. */
export function takePendingAbort(tabId: number): boolean {
  return _pendingAborts.delete(tabId);
}

export async function callAI(messages: ChatMessage[], tabId: number, options: CallAIOptions = {}): Promise<void> {
  const tabStateOrNull = core.getStateForTab(tabId);
  if (!tabStateOrNull) return;
  // A separate const so narrowing reaches the hoisted closures below
  // (function declarations may be invoked before the guard in TS's view).
  const tabState = tabStateOrNull;

  useTabsStore.getState().setGeneratingForTab(tabId, true);
  const assistantId = useStreamStore.getState().start(tabId);
  const streamApi = useStreamStore.getState();

  // F11: the tools this answer used — persisted with it as the evidence trail.
  const agentTrace: AgentTraceStep[] = [];
  let agentRound = 0;

  const port = openAIChatPort();
  port.postMessage(options.agent
    ? { type: 'chat', messages, purpose: 'agent', tools: AGENT_TOOL_SPECS }
    : { type: 'chat', messages });

  // Window-global TTS autoplay: claim the audio resource for this answer
  // before the first chunk (a running podcast stops; a previous playback is
  // taken over by the player's single takeover point).
  ttsAutoplayStart(tabId, assistantId);

  let finished = false;
  _activeStreams.set(tabId, { abort: () => finalize({ kind: 'aborted' }) });

  port.onMessage.addListener((msg: StreamMessage) => {
    if (finished) return;
    if (msg.type === 'thinking') {
      streamApi.appendThinking(tabId, msg.content || '');
    } else if (msg.type === 'chunk') {
      streamApi.appendAnswer(tabId, msg.content || '');
      ttsAutoplayChunk(msg.content || '');
    } else if (msg.type === 'agent_round') {
      agentRound = msg.round;
      streamApi.startRound(tabId, msg.round);
    } else if (msg.type === 'tool_call') {
      void handleAgentToolCall(msg.call);
    } else if (msg.type === 'done') {
      finalize({ kind: 'done', finishReason: msg.finishReason, usage: msg.usage, model: msg.model, limit: msg.limit });
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

  /** Run one tool call and answer the worker on the same port. */
  async function handleAgentToolCall(call: ToolCall): Promise<void> {
    if (agentRound === 0) {
      agentRound = 1;
      streamApi.startRound(tabId, 1);
    }
    // Trace entries are flushed in call order (a done map behind an
    // arrival-order queue) so the persisted trail matches the live display
    // even when tools finish out of order.
    traceQueue.push(call.id);
    streamApi.addToolCall(tabId, call);
    const content = await runAgentTool(call.name, call.arguments, tabId);
    if (finished) return;
    streamApi.setToolResult(tabId, call.id, excerpt(content));
    pushTraceEntry(call.id, { name: call.name, args: shortArgs(call.arguments), result: excerpt(content), round: agentRound });
    try { port.postMessage({ type: 'tool_result', toolCallId: call.id, name: call.name, content }); } catch { /* stream ended */ }
  }

  const traceQueue: string[] = [];
  const traceDone = new Map<string, AgentTraceStep>();

  function pushTraceEntry(callId: string, step: AgentTraceStep): void {
    traceDone.set(callId, step);
    while (traceQueue.length > 0 && traceDone.has(traceQueue[0]!)) {
      const next = traceQueue.shift()!;
      agentTrace.push(traceDone.get(next)!);
      traceDone.delete(next);
    }
  }

  /**
   * The single end-of-stream path (done / error / user stop / worker gone).
   * Idempotent: whichever outcome arrives first wins.
   */
  function finalize(outcome: Outcome): void {
    if (finished) return;
    finished = true;
    _activeStreams.delete(tabId);
    try { port.disconnect(); } catch { /* already disconnected */ }

    const live = useStreamStore.getState().streams[tabId];
    const text = live?.answer ?? '';

    // A refusal with nothing written is an error the user should see, not an
    // empty answer.
    if (outcome.kind === 'done' && outcome.finishReason === 'refusal' && text === '') {
      outcome = { kind: 'error', errorText: t('error.refused'), errorKey: 'error.refused' };
    }
    const keepsAnswer = outcome.kind === 'done' || (text !== '' && (outcome.kind === 'aborted' || outcome.kind === 'disconnected'));

    if (keepsAnswer) {
      // Append to THAT tab's history (it may be a background tab) — never
      // through the active-tab-scoped store wrappers. The finish info
      // (usage / truncation / step-limit) persists with the message so the
      // usage footer and notes survive reloads.
      historyOps.appendMessage(tabState, {
        id: assistantId,
        role: 'assistant',
        content: text,
        // F11: persist the evidence trail with the answer (only when the
        // model actually used tools) so reloads can rebuild the trace block.
        ...(agentTrace.length ? { agentTrace } : {}),
        ...(outcome.kind === 'done'
          ? { finish: { reason: outcome.finishReason, limit: outcome.limit, usage: outcome.usage, model: outcome.model } }
          : {}),
      }, tabId);
      useStreamStore.getState().clear(tabId);
      useTabsStore.getState().setGeneratingForTab(tabId, false);
      if (outcome.kind === 'done') {
        // Autoplay tail flush + suggestion chips attach here.
        ttsAutoplayFinish();
        generateSuggestionsFor(tabId);
      } else {
        // Partial answer kept after stop/disconnect — ephemeral outcome note
        // (the answer itself is already in history).
        useUIStore.getState().pushToast(outcome.kind === 'aborted' ? t('ai.stopped') : t('error.apiFailed'));
      }
      // Save THAT tab's chat — it may be a background tab (saving the active
      // tab's chat here would save the wrong conversation, or early-return
      // on an empty one and lose the answer forever). Save failures are
      // non-fatal (quota / storage errors must not surface as stream errors).
      void saveCurrentChat(tabId).catch(() => {});
      return;
    }

    if (outcome.kind === 'aborted') {
      // Stopped before any answer text: drop the unanswered turn from
      // history, but keep it VISIBLE on the stream entry with its retry
      // affordance (legacy kept the bubble) + a quiet note.
      const hist = tabState.conversationHistory;
      const failedUser = hist.length > 0 && hist[hist.length - 1]!.role === 'user' ? hist[hist.length - 1]! : undefined;
      historyOps.rollbackTrailingUserMessage(tabState, tabId);
      useStreamStore.getState().abort(tabId, t('ai.stopped'), failedUser);
      useTabsStore.getState().setGeneratingForTab(tabId, false);
      return;
    }

    const errorText = outcome.kind === 'error' ? outcome.errorText : t('error.apiFailed');
    const errorKey = outcome.kind === 'error' ? outcome.errorKey : undefined;
    const hist = tabState.conversationHistory;
    const failedUserMessage = hist.length > 0 && hist[hist.length - 1]!.role === 'user' ? hist[hist.length - 1]! : undefined;
    historyOps.rollbackTrailingUserMessage(tabState, tabId);
    useStreamStore.getState().fail(tabId, errorText, failedUserMessage, errorKey);
    useTabsStore.getState().setGeneratingForTab(tabId, false);
  }
}

// --- small pure helpers (kept local; display-shaping only) ------------------

function excerpt(content: string): string {
  return content.length > 200 ? `${content.slice(0, 200)}…` : content;
}

function shortArgs(argsJson: string): string {
  try {
    const parsed = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    const keys = Object.entries(parsed).map(([k, v]) => (typeof v === 'string' && v.length > 40 ? `${k}=${v.slice(0, 40)}…` : `${k}=${String(v)}`));
    return keys.join(' ') || '{}';
  } catch {
    return argsJson.slice(0, 60);
  }
}
