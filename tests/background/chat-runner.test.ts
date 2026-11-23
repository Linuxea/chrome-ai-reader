import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatDelta, ChatRequest } from '../../src/background/providers/types';
import { ProviderError } from '../../src/background/providers/types';
import type { WebResult } from '../../src/shared/types';
import { getPrompt } from '../../src/shared/prompts';

// Scripted providers: each call to stream() shifts the next script. A script
// is the deltas to yield, 'hang' (never yields), or `{ deltas, fail, gate }` —
// yield those deltas, wait for `gate` (if any), then throw (a connection
// dropping mid-stream).
type Script = ChatDelta[] | 'hang' | { deltas: ChatDelta[]; fail: Error; gate?: Promise<void> };
const { scripts, requests, settings, posted } = vi.hoisted(() => ({
  scripts: [] as Script[],
  requests: [] as { provider: string; req: ChatRequest; apiBase: string }[],
  settings: {} as Record<string, unknown>,
  posted: [] as Record<string, unknown>[],
}));

function fakeProvider(name: string) {
  return {
    async *stream(config: { apiBase: string }, req: ChatRequest, signal: AbortSignal) {
      requests.push({ provider: name, req: structuredClone({ ...req, messages: req.messages.map((m) => ({ ...m, providerContent: undefined })) }), apiBase: config.apiBase });
      const s: Script = scripts.shift() ?? [];
      if (s === 'hang') {
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
        return;
      }
      if (!Array.isArray(s)) {
        for (const d of s.deltas) yield d;
        if (s.gate) await s.gate;
        throw s.fail;
      }
      for (const d of s) yield d;
    },
  };
}
vi.mock('../../src/background/providers/openai', () => ({ openaiProvider: fakeProvider('openai') }));
vi.mock('../../src/background/providers/anthropic', () => ({ anthropicProvider: fakeProvider('anthropic') }));
vi.mock('../../src/background/usage', () => ({ recordUsage: vi.fn() }));
vi.mock('../../src/background/sw-utils', () => ({ safePostMessage: (_p: unknown, m: Record<string, unknown>) => posted.push(m) }));
vi.mock('../../src/platform/settings', () => ({
  DEFAULT_API_BASE: 'https://api.deepseek.com',
  DEFAULT_ANTHROPIC_API_BASE: 'https://api.anthropic.com',
  readSettings: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settings[k]])),
  readStoredSettings: async (keys: string[]) => Object.fromEntries(keys.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]])),
}));

import { streamToPort, completeChat, IDLE_TIMEOUT_MS, MAX_ATTEMPTS } from '../../src/background/chat-runner';
import { recordUsage } from '../../src/background/usage';

function mockPort() {
  const msgListeners = new Set<(m: unknown) => void>();
  const discListeners = new Set<() => void>();
  return {
    onMessage: { addListener: (f: (m: unknown) => void) => msgListeners.add(f), removeListener: (f: (m: unknown) => void) => msgListeners.delete(f) },
    onDisconnect: { addListener: (f: () => void) => discListeners.add(f), removeListener: (f: () => void) => discListeners.delete(f) },
    send(m: unknown) { msgListeners.forEach((f) => f(m)); },
    /** The panel's end of the port went away. */
    _disconnect() { discListeners.forEach((f) => f()); },
  } as unknown as chrome.runtime.Port & { send(m: unknown): void; _disconnect(): void };
}

beforeEach(() => {
  scripts.length = 0; requests.length = 0; posted.length = 0;
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, { apiKey: 'k', modelName: 'main-model' });
  vi.mocked(recordUsage).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('chat-runner streamToPort', () => {
  it('streams chunks then one done with finish reason, usage and model; records usage', async () => {
    scripts.push([{ type: 'text', text: 'a' }, { type: 'thinking', text: 't' }, { type: 'finish', reason: 'stop', usage: { inputTokens: 5, outputTokens: 2 } }]);
    await streamToPort(mockPort(), { messages: [{ role: 'user', content: 'q' }] });
    expect(posted).toEqual([
      { type: 'chunk', content: 'a' },
      { type: 'thinking', content: 't' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2 }, model: 'main-model' },
    ]);
    expect(recordUsage).toHaveBeenCalledWith('main-model', { inputTokens: 5, outputTokens: 2 });
    expect(requests[0]).toMatchObject({ provider: 'openai', apiBase: 'https://api.deepseek.com' });
  });

  it('errors with a config key when no API key / model is set', async () => {
    settings.apiKey = '';
    await streamToPort(mockPort(), { messages: [], noKeyErrorKey: 'error.noApiKeySuggest' });
    expect(posted).toEqual([{ type: 'error', errorKey: 'error.noApiKeySuggest' }]);
  });

  it('routes anthropic settings to the anthropic provider', async () => {
    Object.assign(settings, { provider: 'anthropic' });
    scripts.push([{ type: 'finish', reason: 'stop' }]);
    await streamToPort(mockPort(), { messages: [] });
    expect(requests[0]).toMatchObject({ provider: 'anthropic', apiBase: 'https://api.anthropic.com', req: { model: 'main-model' } });
  });

  it('gives up on a silent upstream after the idle timeout', async () => {
    vi.useFakeTimers();
    scripts.push('hang');
    const run = streamToPort(mockPort(), { messages: [] });
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 10);
    await run;
    expect(posted).toEqual([{ type: 'error', errorKey: 'error.streamTimeout' }]);
    // …without a retry: a second silent attempt would only wait another 90 s.
    expect(requests).toHaveLength(1);
  });

  // A connection that drops before any answer text → one automatic retry.
  describe('retry when the connection drops before any answer text', () => {
    const STARTED_EVENT = { type: 'call_started' as const, step: 0, call: { id: 'c1', index: 0, kind: 'deep_search' as const, action: { type: 'search' as const, queries: ['q'] } } };
    const STARTED: ChatDelta = { type: 'search_event', event: STARTED_EVENT };
    const drop = new TypeError('network error');

    it('retries once with the same request and delivers the second attempt', async () => {
      scripts.push({ deltas: [STARTED, { type: 'thinking', text: 'hmm' }], fail: drop });
      scripts.push([{ type: 'text', text: 'ok' }, { type: 'finish', reason: 'stop', usage: { inputTokens: 5, outputTokens: 2 } }]);
      await streamToPort(mockPort(), { messages: [{ role: 'user', content: 'q' }], webSearch: true });
      expect(posted).toEqual([
        { type: 'search_event', event: STARTED_EVENT },
        { type: 'thinking', content: 'hmm' },
        { type: 'retry', attempt: 1 },
        { type: 'chunk', content: 'ok' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2 }, model: 'main-model' },
      ]);
      expect(requests).toHaveLength(2);
      expect(requests[1]!.req).toEqual(requests[0]!.req);
      expect(recordUsage).toHaveBeenCalledTimes(1); // the dead attempt recorded nothing
      expect(MAX_ATTEMPTS).toBe(2);
    });

    it('does not retry once answer text has been delivered', async () => {
      scripts.push({ deltas: [{ type: 'text', text: 'part' }], fail: drop });
      await streamToPort(mockPort(), { messages: [] });
      expect(posted).toEqual([{ type: 'chunk', content: 'part' }, { type: 'error', error: 'network error' }]);
      expect(requests).toHaveLength(1);
    });

    it('does not retry a request the server refused (an HTTP status)', async () => {
      scripts.push({ deltas: [], fail: new ProviderError('Please use deepseek-flash instead.', 400) });
      await streamToPort(mockPort(), { messages: [] });
      expect(posted).toEqual([{ type: 'error', error: 'Please use deepseek-flash instead.' }]);
      expect(requests).toHaveLength(1);
    });

    it('retries at most once: a second drop is reported', async () => {
      scripts.push({ deltas: [STARTED], fail: drop }, { deltas: [{ type: 'thinking', text: 'again' }], fail: drop });
      await streamToPort(mockPort(), { messages: [] });
      expect(posted).toEqual([
        { type: 'search_event', event: STARTED_EVENT },
        { type: 'retry', attempt: 1 },
        { type: 'thinking', content: 'again' },
        { type: 'error', error: 'network error' },
      ]);
      expect(requests).toHaveLength(2);
    });

    it('does not retry when the panel already went away', async () => {
      // The drop happens only after the runner has registered its disconnect
      // listener (which it does once the settings are read) and the panel left.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      scripts.push({ deltas: [{ type: 'thinking', text: 'x' }], fail: drop, gate });
      const port = mockPort();
      const run = streamToPort(port, { messages: [] });
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      port._disconnect();
      release();
      await run;
      expect(posted).toEqual([{ type: 'thinking', content: 'x' }]); // no retry, no error: nobody is listening
      expect(requests).toHaveLength(1);
    });
  });

  // F15 web search
  it('web search: builds the rule + reminder for the provider and forwards call events and the result', async () => {
    settings.language = 'en';
    const web: WebResult = { steps: [], sources: [{ url: 'https://a.test/', title: 'A' }], citations: [{ start: 0, end: 3, source: 0 }], searches: 1, pages: 0 };
    const started = { type: 'call_started' as const, step: 0, call: { id: 'c1', index: 0, kind: 'deep_search' as const, action: { type: 'search' as const, queries: ['q'] } } };
    scripts.push([
      { type: 'search_event', event: { type: 'step_reasoning_done', step: 0 } },
      { type: 'search_event', event: started },
      { type: 'text', text: 'a' },
      { type: 'finish', reason: 'stop', usage: { inputTokens: 5, outputTokens: 2 }, web },
    ]);
    await streamToPort(mockPort(), { messages: [], webSearch: true });
    // The rule follows the UI language; the reminder is the five-field line in that language.
    expect(requests[0].req.webSearch).toEqual({
      rule: getPrompt('websearch.rule', 'en'),
      reminder: expect.stringMatching(/^\d{4}-\d{2}-\d{2},[A-Za-z]+,,Web,English$/),
    });
    // step_reasoning_done is consumed (watchdog only), the call event is forwarded.
    expect(posted).toEqual([
      { type: 'search_event', event: started },
      { type: 'chunk', content: 'a' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2 }, model: 'main-model', web },
    ]);
  });

  it('web search: off unless asked, and never for the batch (completeChat) callers', async () => {
    scripts.push([{ type: 'finish', reason: 'stop' }]);
    await streamToPort(mockPort(), { messages: [] });
    expect(requests[0].req.webSearch).toBeUndefined();
    scripts.push([{ type: 'text', text: 'x' }, { type: 'finish', reason: 'stop' }]);
    await completeChat({ messages: [], webSearch: true, jsonMode: true });
    expect(requests[1].req.webSearch).toBeUndefined();
    expect(requests[1].req.jsonMode).toBe(true);
  });

  it('web search: the rule and reminder default to Chinese', async () => {
    scripts.push([{ type: 'finish', reason: 'stop' }]);
    await streamToPort(mockPort(), { messages: [], webSearch: true });
    expect(requests[0].req.webSearch).toEqual({
      rule: getPrompt('websearch.rule', 'zh'),
      reminder: expect.stringMatching(/,Web,中文$/),
    });
  });
});

describe('chat-runner completeChat', () => {
  it('collects the text', async () => {
    scripts.push([{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }, { type: 'finish', reason: 'stop' }]);
    const r = await completeChat({ messages: [], jsonMode: true });
    expect(r.text).toBe('{"a":1}');
    expect(requests[0].req.jsonMode).toBe(true);
  });

  it('throws an error carrying the errorKey when not configured', async () => {
    settings.modelName = '';
    await expect(completeChat({ messages: [] })).rejects.toMatchObject({ errorKey: 'error.noModelName' });
  });
});
