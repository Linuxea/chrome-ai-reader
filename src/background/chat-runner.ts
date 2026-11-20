/**
 * The one chat pipeline in the service worker for plain (non-agent) chat.
 * Every model call — the chat port, suggestions, podcast script,
 * annotation, translation, quizzes — runs through here, whatever the
 * provider:
 *
 *   settings → provider + model
 *   → provider.stream() deltas → port messages / collected text
 *
 * It owns what used to be scattered or missing: abort on port disconnect,
 * an idle watchdog (a silent upstream no longer leaves the panel
 * "generating" forever), finish reason + token usage on `done`, and usage
 * accounting. The agent tool loop (F11) lives in agent-runner.ts on the
 * Vercel AI SDK.
 */

import { safePostMessage } from './sw-utils';
import { readSettings, readStoredSettings, DEFAULT_API_BASE, DEFAULT_ANTHROPIC_API_BASE } from '../platform/settings';
import type { ChatMessage } from '../shared/types';
import type { FinishReason, TokenUsage } from '../shared/protocol';
import type { ChatProvider, ChatRequest, ProviderConfig } from './providers/types';
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { recordUsage } from './usage';

/** No bytes from the model for this long → give up with error.streamTimeout. */
export const IDLE_TIMEOUT_MS = 90_000;

/** Labels the ai-chat request kind; 'agent' is routed to agent-runner.ts. */
export type Purpose = 'chat' | 'agent';

export interface RunOptions {
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
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

export async function resolveProvider(noKeyErrorKey = 'error.noApiKey'): Promise<ResolveResult> {
  const [s, stored] = await Promise.all([
    readSettings(['provider', 'apiKey', 'modelName']),
    readStoredSettings(['apiBase']),
  ]);
  if (!s.apiKey) return { ok: false, errorKey: noKeyErrorKey };
  const model = s.modelName;
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

/**
 * Stream a chat to a port: `thinking` / `chunk` messages while generating,
 * then exactly one `done` or `error`.
 */
export async function streamToPort(port: chrome.runtime.Port, opts: RunOptions): Promise<void> {
  const resolved = await resolveProvider(opts.noKeyErrorKey);
  if (!resolved.ok) { safePostMessage(port, { type: 'error', errorKey: resolved.errorKey }); return; }
  const { provider, config, model } = resolved.value;

  const controller = new AbortController();
  let portGone = false;
  const onDisconnect = () => { portGone = true; controller.abort(); };
  port.onDisconnect.addListener(onDisconnect);
  const watchdog = idleWatchdog(controller);

  let usage: TokenUsage | undefined;
  let finish: FinishReason = 'stop';

  try {
    const req: ChatRequest = { model, messages: [...opts.messages], temperature: opts.temperature, jsonMode: opts.jsonMode };
    watchdog.kick();
    for await (const delta of provider.stream(config, req, controller.signal)) {
      watchdog.kick();
      if (delta.type === 'text') { safePostMessage(port, { type: 'chunk', content: delta.text }); }
      else if (delta.type === 'thinking') { if (opts.emitThinking !== false) safePostMessage(port, { type: 'thinking', content: delta.text }); }
      else if (delta.type === 'finish') { finish = delta.reason; usage = delta.usage; }
    }
    watchdog.pause();

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
  const resolved = await resolveProvider(opts.noKeyErrorKey);
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
