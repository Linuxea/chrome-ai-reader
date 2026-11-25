/**
 * The one chat pipeline in the service worker. Every model call — the chat
 * port, suggestions, podcast script, annotation, translation, quizzes — runs
 * through here, whatever the provider:
 *
 *   settings → provider + model
 *   → provider.stream() deltas → port messages / collected text
 *
 * It owns what used to be scattered or missing: abort on port disconnect,
 * an idle watchdog (a silent upstream no longer leaves the panel
 * "generating" forever), finish reason + token usage on `done`, and usage
 * accounting.
 */

import { safePostMessage } from './sw-utils';
import { readSettings, readStoredSettings, DEFAULT_API_BASE, DEFAULT_ANTHROPIC_API_BASE } from '../platform/settings';
import { getPrompt, type Lang } from '../shared/prompts';
import { buildLatestReminder } from '../shared/latest-reminder';
import type { ChatMessage } from '../shared/types';
import type { FinishReason, TokenUsage } from '../shared/protocol';
import type { WebResult } from '../shared/types';
import type { ChatProvider, ChatRequest, ProviderConfig } from './providers/types';
import { ProviderError } from './providers/types';
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { recordUsage } from './usage';

/** No bytes from the model for this long → give up with error.streamTimeout. */
export const IDLE_TIMEOUT_MS = 90_000;

/** Requests per chat turn: the first, plus one retry when the connection drops before any answer text. */
export const MAX_ATTEMPTS = 2;

export interface RunOptions {
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
  /** Forward reasoning as `thinking` messages (chat UI) — off for suggestions. */
  emitThinking?: boolean;
  /** errorKey for a missing API key (suggestions use their own wording). */
  noKeyErrorKey?: string;
  /**
   * F15: declare DeepSeek's web search tool. Chat only — the batch callers
   * (suggestions, podcast, annotation, …) never set it, and several of them
   * use JSON mode, which the API refuses next to the tool.
   */
  webSearch?: boolean;
}

interface Resolved {
  provider: ChatProvider;
  config: ProviderConfig;
  model: string;
  /** UI language ('zh' | 'en'), for the web search rule and the date reminder. */
  lang: Lang;
}

type ResolveResult = { ok: true; value: Resolved } | { ok: false; errorKey: string };

export async function resolveProvider(noKeyErrorKey = 'error.noApiKey'): Promise<ResolveResult> {
  const [s, stored] = await Promise.all([
    readSettings(['provider', 'apiKey', 'modelName', 'language']),
    readStoredSettings(['apiBase']),
  ]);
  if (!s.apiKey) return { ok: false, errorKey: noKeyErrorKey };
  const model = s.modelName;
  if (!model) return { ok: false, errorKey: 'error.noModelName' };
  const anthropic = s.provider === 'anthropic';
  const apiBase = (stored.apiBase || (anthropic ? DEFAULT_ANTHROPIC_API_BASE : DEFAULT_API_BASE)).replace(/\/+$/, '');
  const lang: Lang = s.language === 'en' ? 'en' : 'zh';
  return {
    ok: true,
    value: { provider: anthropic ? anthropicProvider : openaiProvider, config: { apiKey: s.apiKey, apiBase }, model, lang },
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
  const { provider, config, model, lang } = resolved.value;

  const controller = new AbortController();
  let portGone = false;
  const onDisconnect = () => { portGone = true; controller.abort(); };
  port.onDisconnect.addListener(onDisconnect);
  const watchdog = idleWatchdog(controller);

  let usage: TokenUsage | undefined;
  let finish: FinishReason;
  let web: WebResult | undefined;

  try {
    const req: ChatRequest = {
      model,
      messages: [...opts.messages],
      temperature: opts.temperature,
      jsonMode: opts.jsonMode,
      // F15: the rule and the date reminder are built here, in the worker,
      // because only it knows the tool will actually be declared.
      ...(opts.webSearch ? { webSearch: { rule: getPrompt('websearch.rule', lang), reminder: buildLatestReminder(lang) } } : {}),
    };
    for (let attempt = 1; ; attempt++) {
      // Every attempt starts clean: a retried one must not inherit the dead
      // attempt's finish reason / usage / web record.
      let textStarted = false;
      finish = 'stop'; usage = undefined; web = undefined;
      try {
        watchdog.kick();
        for await (const delta of provider.stream(config, req, controller.signal)) {
          watchdog.kick();
          if (delta.type === 'text') { textStarted = true; safePostMessage(port, { type: 'chunk', content: delta.text }); }
          else if (delta.type === 'thinking') { if (opts.emitThinking !== false) safePostMessage(port, { type: 'thinking', content: delta.text }); }
          else if (delta.type === 'search_event') {
            // `step_reasoning_done` only exists to keep the watchdog alive above;
            // the trace the panel shows is built from the call events.
            if (delta.event.type !== 'step_reasoning_done') safePostMessage(port, { type: 'search_event', event: delta.event });
          }
          else if (delta.type === 'finish') { finish = delta.reason; usage = delta.usage; web = delta.web; }
        }
        break; // completed
      } catch (e: unknown) {
        // The connection dropped (or the API ended the stream with an error)
        // before any answer text was produced — nothing is lost by starting
        // over, so do it once instead of making the user press retry. Long
        // streams are exposed to this: measured 2026-11-23 on the test
        // machine, a plain streaming fetch of one web-search answer broke
        // mid-body in 6 of 16 runs (HTTP/2), a third of them before any text.
        // Never retried: a failure after text started (the panel may have
        // shown it), an HTTP status (the request itself was refused — it
        // would be again), the idle watchdog, and a closed port.
        const transportLevel = !(e instanceof ProviderError && e.status);
        if (attempt >= MAX_ATTEMPTS || textStarted || portGone || watchdog.fired() || !transportLevel) throw e;
        safePostMessage(port, { type: 'retry', attempt });
      }
    }
    watchdog.pause();

    if (usage) recordUsage(model, usage);
    safePostMessage(port, { type: 'done', finishReason: finish, usage, model, ...(web ? { web } : {}) });
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
