import { t } from '../../shared/i18n.js';
import { openOptionsPage } from '../../platform/messaging';
import * as state from '../state';
import { on, emit, EVENTS } from '../events';
import {
  appendMessage, appendMessageFromHistory, appendErrorMessage, addTypingIndicator,
  removeTypingIndicator, smartScrollToBottom, scrollToBottom,
  setButtonsDisabled,
  addErrorMessageActions, emitRetryFromWrapper, findUserWrapperBefore, createNoteElement as noteEl,
  type ErrorMessageAction,
} from '../ui/dom-helpers';
import {
  initTTSPlayback, ttsAppendChunk,
  addTTSButton, initTTSAutoPlay, isTTSAutoPlay,
} from './tts/index.js';
import { createAnswerView } from '../ui/answer-view';
import { AGENT_TOOL_SPECS, runAgentTool } from './agent-tools';
import {
  agentToolLabel, describeArgs, excerptResult,
  createAgentStepLine, attachStepResult, createAgentRoundHeader,
} from '../ui/agent-trace';
import { genId } from '../../shared/ids';
import type { AgentTraceStep, ChatMessage, ToolCall } from '../../shared/types';
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
  | { kind: 'done'; finishReason?: FinishReason; usage?: TokenUsage; model?: string; limit?: 'steps' }
  | { kind: 'error'; errorText: string; errorKey?: string }
  | { kind: 'aborted' }
  /** The service worker's end went away (worker restart / crash). */
  | { kind: 'disconnected' };

export interface CallAIOptions {
  /** Agent mode: offer the panel's tools; the worker loops until an answer. */
  agent?: boolean;
}

export async function callAI(messages: ChatMessage[], tabId: number | null, options: CallAIOptions = {}): Promise<void> {
  // TTS is a window-global "printer resource": a plain send does NOT stop it —
  // only an actually-starting playback takes it over (initTTSPlayback below,
  // via the player's takeover point).
  const tabState = state.getStateForTab(tabId!);
  if (!tabState) return;

  state.setGeneratingForTab(tabId!, true);
  setButtonsDisabled(true);

  if (isTTSAutoPlay()) {
    initTTSPlayback({ tabId });
  }

  // The answer bubble is built even while detached (tab in the background):
  // DOM nodes are cheap, and only the markdown flush is skipped until the
  // bubble is re-attached.
  const assistantId = genId();
  const msgEl = appendMessage('ai', '');
  // TTS re-attach anchor: the window-global playback outlives chat-area
  // rebuilds and resolves its button by this id (see services/tts).
  msgEl.dataset.msgId = assistantId;
  const typingEl = addTypingIndicator(msgEl);
  const view = createAnswerView(msgEl, () => isCurrentTab());
  let finished = false;
  // F11: the tools this answer used — persisted with it as the evidence trail.
  const agentTrace: AgentTraceStep[] = [];
  let agentRound = 0;

  const port = openAIChatPort();

  port.postMessage(options.agent
    ? { type: 'chat', messages, purpose: 'agent', tools: AGENT_TOOL_SPECS }
    : { type: 'chat', messages });

  _activeStreams.set(tabId!, {
    abort: () => finalize({ kind: 'aborted' }),
    reattach,
  });

  function isCurrentTab(): boolean { return state.getActiveTabId() === tabId; }

  /** The tab became active again and its chat area was rebuilt: put the live bubble back. */
  function reattach(): void {
    if (finished || msgEl.isConnected || !isCurrentTab()) return;
    _chatArea.appendChild(msgEl);
    view.flushNow();
    scrollToBottom();
  }

  port.onMessage.addListener((msg: StreamMessage) => {
    if (finished) return;
    if (msg.type === 'thinking') {
      removeTypingIndicator(typingEl);
      view.appendThinking(msg.content || '');
    } else if (msg.type === 'chunk') {
      removeTypingIndicator(typingEl);
      view.appendText(msg.content || '');
      // Feed the window-global TTS regardless of tab visibility — autoplay
      // keeps reading the answer aloud while it streams in the background.
      if (isTTSAutoPlay()) {
        ttsAppendChunk(msg.content || '');
      }
    } else if (msg.type === 'tool_calls') {
      removeTypingIndicator(typingEl);
      void runToolCalls(msg.calls);
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

  /**
   * Agent mode: show each step, run the tools here, send the results back.
   * Lines are created up-front so display order is stable while executions
   * run in parallel and light up independently. Trace entries are collected
   * by call position and pushed in order after the round, so the persisted
   * trail matches the live display even when tools finish out of order.
   */
  async function runToolCalls(calls: ToolCall[]): Promise<void> {
    agentRound++;
    let steps = msgEl.querySelector<HTMLElement>('.agent-steps');
    if (!steps) {
      steps = document.createElement('div');
      steps.className = 'agent-steps';
      msgEl.insertBefore(steps, msgEl.firstChild);
    }
    if (agentRound > 1) steps.appendChild(createAgentRoundHeader(agentRound));

    type Result = { tool_call_id: string; name: string; content: string };
    const results: (Result | undefined)[] = new Array(calls.length);
    const entries: (AgentTraceStep | undefined)[] = new Array(calls.length);
    await Promise.all(calls.map(async (call, i) => {
      const line = createAgentStepLine(call.name, describeArgs(call.arguments));
      steps!.appendChild(line);
      // read_tab: resolve the tab's title in parallel with the tool run — it
      // feeds both the live line and the persisted trace entry.
      const titlePromise = call.name === 'read_tab' ? readTabTitle(call.arguments) : null;
      if (titlePromise) void titlePromise.then((title) => {
        if (title && !finished) line.textContent = t('agent.step', { tool: agentToolLabel(call.name), args: title });
      });
      const content = await runAgentTool(call.name, call.arguments, tabId!);
      const tabTitle = titlePromise ? await titlePromise : null;
      if (finished) return;
      const argsText = tabTitle ?? describeArgs(call.arguments);
      line.classList.add('done');
      attachStepResult(line, content);
      results[i] = { tool_call_id: call.id, name: call.name, content };
      entries[i] = { name: call.name, args: argsText, result: excerptResult(content), round: agentRound };
    }));
    if (finished) return;
    agentTrace.push(...entries.filter((e): e is AgentTraceStep => e !== undefined));
    try { port.postMessage({ type: 'tool_results', results: results.filter((r): r is Result => r !== undefined) }); } catch { /* stream ended */ }
  }

  /** Look up a tab's title for the step display; null when unavailable. */
  function readTabTitle(argsJson: string): Promise<string | null> {
    return new Promise((resolve) => {
      let id: number;
      try { id = Number((JSON.parse(argsJson || '{}') as { tab_id?: unknown }).tab_id); } catch { resolve(null); return; }
      if (!Number.isInteger(id)) { resolve(null); return; }
      if (typeof chrome.tabs?.get !== 'function') { resolve(null); return; }
      try {
        chrome.tabs.get(id, (tab) => {
          if (chrome.runtime.lastError || !tab?.title) resolve(null);
          else resolve(tab.title);
        });
      } catch { resolve(null); }
    });
  }

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
    view.cancelFlush();
    _activeStreams.delete(tabId!);
    try { port.disconnect(); } catch { /* already disconnected */ }
    removeTypingIndicator(typingEl);

    // A disconnect / stop that already produced text keeps the partial answer
    // (so nothing streamed is lost); one that produced nothing is a failure
    // (disconnect) or a silent no-op (stop).
    // A refusal with nothing written is an error the user should see, not an empty answer.
    if (outcome.kind === 'done' && outcome.finishReason === 'refusal' && view.text === '') {
      outcome = { kind: 'error', errorText: t('error.refused'), errorKey: 'error.refused' };
    }
    const keepsAnswer = outcome.kind === 'done' || (view.text !== '' && (outcome.kind === 'aborted' || outcome.kind === 'disconnected'));

    if (keepsAnswer) {
      appendHistory(tabState!, {
        id: assistantId,
        role: 'assistant',
        content: view.text,
        // F11: persist the evidence trail with the answer (only when the
        // model actually used tools) so reloads can rebuild the trace block.
        ...(agentTrace.length ? { agentTrace } : {}),
      }, tabId!);
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
      view.collapseThinking();
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
  function annotateAnswer(outcome: { finishReason?: FinishReason; usage?: TokenUsage; model?: string; limit?: 'steps' }): void {
    if (!msgEl.isConnected) return;
    if (outcome.finishReason === 'length') {
      // 'steps' = the agent tool-round limit, not the output token limit —
      // "ask me to continue" advice would be wrong there.
      msgEl.after(noteEl(outcome.limit === 'steps' ? t('agent.stepLimit') : t('ai.truncatedByLimit')));
    }
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
      // The window-global TTS kept reading in the background — flush the
      // answer's tail into it and bind its re-attach anchor (msgId).
      initTTSAutoPlay(msgEl);
      return;
    }
    msgEl.dataset.markdown = view.text; // copy button copies the markdown source
    let answerEl: HTMLElement | null = msgEl;
    if (!msgEl.isConnected) {
      emit(EVENTS.REQUEST_RERENDER);
      const answers = _chatArea.querySelectorAll<HTMLElement>('.message-ai');
      answerEl = answers[answers.length - 1] ?? null;
    } else {
      view.flushNow(); // render the complete text before buttons/summary attach
      view.collapseThinking();
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
