import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatDelta, ChatRequest } from '../../src/background/providers/types';

// Scripted providers: each call to stream() shifts the next script.
const { scripts, requests, settings, posted } = vi.hoisted(() => ({
  scripts: [] as (ChatDelta[] | 'hang')[],
  requests: [] as { provider: string; req: ChatRequest; apiBase: string }[],
  settings: {} as Record<string, unknown>,
  posted: [] as Record<string, unknown>[],
}));

function fakeProvider(name: string) {
  return {
    async *stream(config: { apiBase: string }, req: ChatRequest, signal: AbortSignal) {
      requests.push({ provider: name, req: structuredClone({ ...req, messages: req.messages.map((m) => ({ ...m, providerContent: undefined })) }), apiBase: config.apiBase });
      const s = scripts.shift() ?? [];
      if (s === 'hang') {
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
        return;
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

import { streamToPort, completeChat, IDLE_TIMEOUT_MS } from '../../src/background/chat-runner';
import { recordUsage } from '../../src/background/usage';

function mockPort() {
  const msgListeners = new Set<(m: unknown) => void>();
  const discListeners = new Set<() => void>();
  return {
    onMessage: { addListener: (f: (m: unknown) => void) => msgListeners.add(f), removeListener: (f: (m: unknown) => void) => msgListeners.delete(f) },
    onDisconnect: { addListener: (f: () => void) => discListeners.add(f), removeListener: (f: () => void) => discListeners.delete(f) },
    send(m: unknown) { msgListeners.forEach((f) => f(m)); },
  } as unknown as chrome.runtime.Port & { send(m: unknown): void };
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

  it('routes light work to the fast model and anthropic settings to the anthropic provider', async () => {
    Object.assign(settings, { provider: 'anthropic', fastModelName: 'claude-haiku-4-5' });
    scripts.push([{ type: 'finish', reason: 'stop' }]);
    await streamToPort(mockPort(), { messages: [], purpose: 'light' });
    expect(requests[0]).toMatchObject({ provider: 'anthropic', apiBase: 'https://api.anthropic.com', req: { model: 'claude-haiku-4-5' } });
  });

  it('gives up on a silent upstream after the idle timeout', async () => {
    vi.useFakeTimers();
    scripts.push('hang');
    const run = streamToPort(mockPort(), { messages: [] });
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 10);
    await run;
    expect(posted).toEqual([{ type: 'error', errorKey: 'error.streamTimeout' }]);
  });

  it('agent mode: hands tool calls to the panel and continues with the results', async () => {
    const call = { id: 'c1', name: 'search_page', arguments: '{"query":"x"}' };
    scripts.push([{ type: 'tool_call', call }, { type: 'finish', reason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1 } }]);
    scripts.push([{ type: 'text', text: 'found it' }, { type: 'finish', reason: 'stop', usage: { inputTokens: 2, outputTokens: 2 } }]);
    const port = mockPort();
    const tools = [{ name: 'search_page', description: 'd', parameters: {} }];
    const run = streamToPort(port, { messages: [{ role: 'user', content: 'q' }], purpose: 'agent', tools });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'tool_calls')).toBe(true));
    port.send({ type: 'tool_results', results: [{ tool_call_id: 'c1', name: 'search_page', content: 'paragraph 3' }] });
    await run;

    expect(requests).toHaveLength(2);
    expect(requests[0].req.tools).toEqual(tools);
    expect(requests[1].req.messages.slice(1)).toEqual([
      { role: 'assistant', content: '', tool_calls: [call] },
      { role: 'tool', tool_call_id: 'c1', name: 'search_page', content: 'paragraph 3' },
    ]);
    expect(posted.at(-1)).toEqual({ type: 'done', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 3 }, model: 'main-model' });
  });

  it('never runs tools outside agent mode', async () => {
    scripts.push([{ type: 'tool_call', call: { id: 'c', name: 'f', arguments: '{}' } }, { type: 'finish', reason: 'tool_calls' }]);
    await streamToPort(mockPort(), { messages: [], tools: [{ name: 'f', description: '', parameters: {} }] });
    expect(requests[0].req.tools).toBeUndefined();
    expect(posted.some((m) => m.type === 'tool_calls')).toBe(false);
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
