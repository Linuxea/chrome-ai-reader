import { vi, describe, it, expect, beforeEach } from 'vitest';
import { openaiProvider, withWebSearch } from '../../../src/background/providers/openai';
import { __resetCapabilities } from '../../../src/background/providers/capabilities';
import type { ChatDelta } from '../../../src/background/providers/types';

const CFG = { apiKey: 'sk', apiBase: 'https://api.test' };

function sse(...payloads: unknown[]): Response {
  const body = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('');
  return new Response(body, { status: 200 });
}

async function collect(it: AsyncIterable<ChatDelta>): Promise<ChatDelta[]> {
  const out: ChatDelta[] = [];
  for await (const d of it) out.push(d);
  return out;
}

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  __resetCapabilities();
});

describe('providers/openai', () => {
  it('streams text + reasoning and reports finish reason and usage', async () => {
    fetchMock.mockResolvedValueOnce(sse(
      { choices: [{ delta: { reasoning_content: 'hmm' } }] },
      { choices: [{ delta: { content: 'Hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } },
      '[DONE]',
    ));
    const out = await collect(openaiProvider.stream(CFG, { model: 'm', messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal));
    expect(out).toEqual([
      { type: 'thinking', text: 'hmm' },
      { type: 'text', text: 'Hi' },
      { type: 'finish', reason: 'length', usage: { inputTokens: 10, outputTokens: 3 } },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('throws on an error payload delivered mid-stream', async () => {
    fetchMock.mockResolvedValueOnce(sse({ choices: [{ delta: { content: 'a' } }] }, { error: { message: 'overloaded' } }));
    await expect(collect(openaiProvider.stream(CFG, { model: 'm', messages: [] }, new AbortController().signal))).rejects.toThrow('overloaded');
  });

  it('drops a rejected stream_options once and remembers it', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unknown parameter: stream_options' } }), { status: 400 }))
      .mockResolvedValueOnce(sse({ choices: [{ delta: { content: 'ok' } }] }, '[DONE]'))
      .mockResolvedValueOnce(sse({ choices: [{ delta: { content: 'ok' } }] }, '[DONE]'));
    await collect(openaiProvider.stream(CFG, { model: 'm', messages: [] }, new AbortController().signal));
    await collect(openaiProvider.stream(CFG, { model: 'm', messages: [] }, new AbortController().signal));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0].stream_options).toBeDefined();
    expect(bodies[1].stream_options).toBeUndefined();
    expect(bodies[2].stream_options).toBeUndefined();
  });

  it('surfaces other 4xx errors with their message', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
    await expect(collect(openaiProvider.stream(CFG, { model: 'm', messages: [] }, new AbortController().signal))).rejects.toThrow('bad key');
  });
});

// F15 web search. Chunk shapes as recorded from the live API
// (docs/design/设计方案_F15_联网搜索.md §10).
describe('providers/openai · F15 web search', () => {
  const SEARCH_CALL = { index: 0, id: 'srvtoolu_00', type: 'deepseek_web_search', kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] } };
  const RESULT = { type: 'url', url: 'https://a.test/1', title: 'A', snippet: '…', site_name: 'A site', site_icon: 'https://…', published_at: null };
  const WEB = { rule: 'RULE', reminder: 'REM' };
  const MSGS = [
    { role: 'system' as const, content: 'rules' },
    { role: 'system' as const, content: 'article' },
    { role: 'user' as const, content: 'q1' },
    { role: 'assistant' as const, content: 'a1' },
    { role: 'user' as const, content: 'q2' },
  ];
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    fetchMock.mockReset();
    __resetCapabilities();
    fetchMock.mockResolvedValueOnce(sse({ choices: [{ delta: { content: 'ok' } }] }, '[DONE]'));
  });

  it('declares the tool and leaves every other request field as it was', async () => {
    await collect(openaiProvider.stream(CFG, { model: 'm', messages: MSGS, webSearch: WEB }, signal()));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ type: 'deepseek_web_search' }]);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.temperature).toBe(0.7);
    expect(body).not.toHaveProperty('web_search_options');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('thinking');
  });

  it('sends the rule after the leading system messages and the reminder right before the last user message', async () => {
    await collect(openaiProvider.stream(CFG, { model: 'm', messages: MSGS, webSearch: WEB }, signal()));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'system', 'system', 'user', 'assistant', 'latest_reminder', 'user']);
    expect(body.messages[2]).toEqual({ role: 'system', content: 'RULE' });
    expect(body.messages[5]).toEqual({ role: 'latest_reminder', content: 'REM' });
  });

  it('without a web search request the messages go out untouched', async () => {
    await collect(openaiProvider.stream(CFG, { model: 'm', messages: MSGS }, signal()));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('tools');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user']);
    expect(body.messages.some((m: { content: string }) => m.content === 'RULE' || m.content === 'REM')).toBe(false);
  });

  it('withWebSearch: rule first when there is no system message; no reminder unless the last message is the user turn', () => {
    const noSystem = [{ role: 'user', content: 'q' }];
    expect(withWebSearch(noSystem, WEB).map(m => [m.role, m.content])).toEqual([
      ['system', 'RULE'], ['latest_reminder', 'REM'], ['user', 'q'],
    ]);
    // A trailing assistant turn cannot host a reminder (the API wants one directly before a user message).
    const trailingAssistant = [...MSGS, { role: 'assistant' as const, content: 'result' }];
    expect(withWebSearch(trailingAssistant, WEB).map(m => m.role)).toEqual(['system', 'system', 'system', 'user', 'assistant', 'user', 'assistant']);
    // No web search → the same array, not a copy.
    expect(withWebSearch(MSGS, undefined)).toBe(MSGS);
  });

  it('streams search progress as events and the calls + citations on the finish delta', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(sse(
      { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: 'hmm' } }] },
      { choices: [{ server_tool_event: { type: 'step_reasoning_done', step: 0 } }] },
      { choices: [{ server_tool_event: { type: 'call_started', step: 0, call: SEARCH_CALL } }] },
      { choices: [{ server_tool_event: { type: 'call_completed', step: 0, call: { index: 0, id: 'srvtoolu_00', status: 'completed', sources: [RESULT] } } }] },
      { choices: [{ delta: { content: 'Answer' } }] },
      { choices: [{ delta: { content: '', reasoning_content: null,
        annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.test/1', title: 'A', start_index: 0, end_index: 6 } }],
        server_tool_calls: [{ index: 0, reasoning_content: 'not kept', calls: [{ ...SEARCH_CALL, status: 'completed', sources: [RESULT] }] }] }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } },
      '[DONE]',
    ));
    const out = await collect(openaiProvider.stream(CFG, { model: 'm', messages: [], webSearch: WEB }, signal()));
    expect(out).toEqual([
      { type: 'thinking', text: 'hmm' },
      { type: 'search_event', event: { type: 'step_reasoning_done', step: 0 } },
      { type: 'search_event', event: { type: 'call_started', step: 0, call: { id: 'srvtoolu_00', index: 0, kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] } } } },
      { type: 'search_event', event: { type: 'call_completed', step: 0, call: { id: 'srvtoolu_00', index: 0, status: 'completed', sources: [{ url: 'https://a.test/1', title: 'A', siteName: 'A site' }] } } },
      { type: 'text', text: 'Answer' },
      { type: 'finish', reason: 'stop', usage: { inputTokens: 10, outputTokens: 3 }, web: {
        steps: [{ id: 'srvtoolu_00', kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] }, status: 'completed', sources: [{ url: 'https://a.test/1', title: 'A', siteName: 'A site' }] }],
        sources: [{ url: 'https://a.test/1', title: 'A', siteName: 'A site' }],
        citations: [{ start: 0, end: 6, source: 0 }],
        searches: 1, pages: 0,
      } },
    ]);
  });

  it('an answer that did not search carries no web field at all', async () => {
    const out = await collect(openaiProvider.stream(CFG, { model: 'm', messages: [], webSearch: WEB }, signal()));
    expect(out).toEqual([{ type: 'text', text: 'ok' }, { type: 'finish', reason: 'stop', usage: undefined }]);
  });

  it('ignores a malformed progress event and keeps streaming', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(sse(
      { choices: [{ server_tool_event: { type: 'call_started' } }] },
      { choices: [{ server_tool_event: 'garbage' }] },
      { choices: [{ server_tool_event: { type: 'call_started', step: 0, call: SEARCH_CALL } }] },
      { choices: [{ delta: { content: 'ok' } }] },
      '[DONE]',
    ));
    const out = await collect(openaiProvider.stream(CFG, { model: 'm', messages: [], webSearch: WEB }, signal()));
    expect(out.filter(d => d.type === 'search_event')).toHaveLength(1);
    expect(out).toContainEqual({ type: 'text', text: 'ok' });
  });
});
