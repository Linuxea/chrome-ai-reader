/**
 * The one chat pipeline in the service worker. Every model call — the chat
 * port, suggestions, podcast script, annotation, translation, quizzes — runs
 * through here, whatever the provider:
 *
 *   settings → provider + model (the optional fast model for 'light' work)
 *   → provider.stream() deltas → port messages / collected text
 *
 * It owns what used to be scattered or missing: abort on port disconnect,
 * an idle watchdog (a silent upstream no longer leaves the panel
 * "generating" forever), finish reason + token usage on `done`, usage
 * accounting, and the agent tool loop (tools run in the side panel; the
 * worker waits for their results on the same port).
 */

import { safePostMessage } from './sw-utils';
import { readSettings, readStoredSettings, DEFAULT_API_BASE, DEFAULT_ANTHROPIC_API_BASE } from '../platform/settings';
import type { ChatMessage, ToolCall } from '../shared/types';
import type { FinishReason, TokenUsage, ToolResultsMessage } from '../shared/protocol';
import type { ChatProvider, ChatRequest, ProviderConfig, ToolSpec } from './providers/types';
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { recordUsage } from './usage';

/** No bytes from the model for this long → give up with error.streamTimeout. */
export const IDLE_TIMEOUT_MS = 90_000;
/** Agent mode: model ↔ tools round trips per user turn. */
export const AGENT_MAX_STEPS = 6;

export type Purpose = 'chat' | 'light' | 'agent';

export interface RunOptions {
  messages: ChatMessage[];
  purpose?: Purpose;
  temperature?: number;
  jsonMode?: boolean;
  tools?: ToolSpec[];
  /** Forward reasoning as `thinking` messages (chat UI) — off for suggestions. */
  emitThinking?: boolean;
  /** errorKey for a missing API key (suggestions use their own wording). */
  noKeyErrorKey?: string;
}

interface Resolved {
  provider: ChatProvider;
  config: ProviderConfig;
  model: string;
}

type ResolveResult = { ok: true; value: Resolved } | { ok: false; errorKey: string };

export async function resolveProvider(purpose: Purpose = 'chat', noKeyErrorKey = 'error.noApiKey'): Promise<ResolveResult> {
  const [s, stored] = await Promise.all([
    readSettings(['provider', 'apiKey', 'modelName', 'fastModelName']),
    readStoredSettings(['apiBase']),
  ]);
  if (!s.apiKey) return { ok: false, errorKey: noKeyErrorKey };
  const model = (purpose === 'light' && s.fastModelName) ? s.fastModelName : s.modelName;
  if (!model) return { ok: false, errorKey: 'error.noModelName' };
  const anthropic = s.provider === 'anthropic';
  const apiBase = (stored.apiBase || (anthropic ? DEFAULT_ANTHROPIC_API_BASE : DEFAULT_API_BASE)).replace(/\/+$/, '');
  return {
    ok: true,
    value: { provider: anthropic ? anthropicProvider : openaiProvider, config: { apiKey: s.apiKey, apiBase }, model },
  };
}

/** Aborts `controller` when no activity is reported for IDLE_TIMEOUT_MS. */
function idleWatchdog(controller: AbortController): { kick: () => void; pause: () => void; stop: () => void; fired: () => boolean } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let didFire = false;
  const stop = () => { if (timer) clearTimeout(timer); timer = null; };
  const kick = () => {
    stop();
    timer = setTimeout(() => { didFire = true; controller.abort(); }, IDLE_TIMEOUT_MS);
  };
  return { kick, pause: stop, stop, fired: () => didFire };
}

const sum = (a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined =>
  !a ? b : !b ? a : { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };

/** Wait for the panel's tool results (agent mode), or null if the port closes. */
function awaitToolResults(port: chrome.runtime.Port): Promise<ToolResultsMessage | null> {
  return new Promise((resolve) => {
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type !== 'tool_results') return;
      cleanup();
      resolve(msg as ToolResultsMessage);
    };
    const onGone = () => { cleanup(); resolve(null); };
    const cleanup = () => { port.onMessage.removeListener(onMsg); port.onDisconnect.removeListener(onGone); };
    port.onMessage.addListener(onMsg);
    port.onDisconnect.addListener(onGone);
  });
}

/**
 * Stream a chat to a port: `thinking` / `chunk` messages while generating,
 * then exactly one `done` or `error`. In agent mode a `tool_calls` message
 * may appear in between; the run then waits for the panel's `tool_results`.
 */
export async function streamToPort(port: chrome.runtime.Port, opts: RunOptions): Promise<void> {
  const resolved = await resolveProvider(opts.purpose, opts.noKeyErrorKey);
  if (!resolved.ok) { safePostMessage(port, { type: 'error', errorKey: resolved.errorKey }); return; }
  const { provider, config, model } = resolved.value;

  const controller = new AbortController();
  let portGone = false;
  const onDisconnect = () => { portGone = true; controller.abort(); };
  port.onDisconnect.addListener(onDisconnect);
  const watchdog = idleWatchdog(controller);

  const messages = [...opts.messages];
  let usage: TokenUsage | undefined;
  let finish: FinishReason = 'stop';
  const tools = opts.purpose === 'agent' ? opts.tools : undefined;

  try {
    for (let step = 0; ; step++) {
      const req: ChatRequest = { model, messages, temperature: opts.temperature, jsonMode: opts.jsonMode, tools };
      const calls: ToolCall[] = [];
      let text = '';
      let providerContent: unknown;
      watchdog.kick();
      for await (const delta of provider.stream(config, req, controller.signal)) {
        watchdog.kick();
        if (delta.type === 'text') { text += delta.text; safePostMessage(port, { type: 'chunk', content: delta.text }); }
        else if (delta.type === 'thinking') { if (opts.emitThinking !== false) safePostMessage(port, { type: 'thinking', content: delta.text }); }
        else if (delta.type === 'tool_call') calls.push(delta.call);
        else if (delta.type === 'finish') { finish = delta.reason; usage = sum(usage, delta.usage); providerContent = delta.providerContent; }
      }
      watchdog.pause();

      // Tools only when the turn completed normally: a max_tokens cut can
      // leave a tool input truncated, and a refusal is never acted on.
      if (!tools || finish !== 'tool_calls' || calls.length === 0) break;
      if (step + 1 >= AGENT_MAX_STEPS) { finish = 'length'; break; }

      const assistant: ChatMessage = { role: 'assistant', content: text, tool_calls: calls, providerContent };
      safePostMessage(port, { type: 'tool_calls', calls, assistant: { ...assistant, providerContent: undefined } });
      const results = await awaitToolResults(port);
      if (!results) return; // panel went away
      messages.push(assistant);
      for (const r of results.results) messages.push({ role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content: r.content });
    }
    if (usage) recordUsage(model, usage);
    safePostMessage(port, { type: 'done', finishReason: finish, usage, model });
  } catch (e: unknown) {
    if (portGone) return;
    if (watchdog.fired()) { safePostMessage(port, { type: 'error', errorKey: 'error.streamTimeout' }); return; }
    safePostMessage(port, { type: 'error', error: (e as Error).message });
  } finally {
    watchdog.stop();
    port.onDisconnect.removeListener(onDisconnect);
  }
}

export interface CompleteResult {
  text: string;
  finishReason: FinishReason;
  usage?: TokenUsage;
}

/**
 * Run a chat to completion and return the text (no port): annotation,
 * translation and other batch work. Throws on error; `signal` cancels.
 */
export async function completeChat(opts: RunOptions & { signal?: AbortSignal }): Promise<CompleteResult> {
  const resolved = await resolveProvider(opts.purpose, opts.noKeyErrorKey);
  if (!resolved.ok) throw Object.assign(new Error(resolved.errorKey), { errorKey: resolved.errorKey });
  const { provider, config, model } = resolved.value;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const watchdog = idleWatchdog(controller);
  let text = '';
  let finishReason: FinishReason = 'stop';
  let usage: TokenUsage | undefined;
  try {
    watchdog.kick();
    for await (const delta of provider.stream(config, { model, messages: opts.messages, temperature: opts.temperature, jsonMode: opts.jsonMode }, controller.signal)) {
      watchdog.kick();
      if (delta.type === 'text') text += delta.text;
      else if (delta.type === 'finish') { finishReason = delta.reason; usage = delta.usage; }
    }
  } catch (e) {
    if (watchdog.fired()) throw Object.assign(new Error('timeout'), { errorKey: 'error.streamTimeout' });
    throw e;
  } finally {
    watchdog.stop();
    opts.signal?.removeEventListener('abort', onAbort);
  }
  if (usage) recordUsage(model, usage);
  return { text, finishReason, usage };
}
