import { vi, describe, it, expect, beforeEach } from 'vitest';
import { openaiProvider, toOpenAIMessages } from '../../../src/background/providers/openai';
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

  it('assembles streamed tool calls', async () => {
    fetchMock.mockResolvedValueOnce(sse(
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_page', arguments: '{"q' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '":"x"}' } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ));
    const out = await collect(openaiProvider.stream(CFG, { model: 'm', messages: [], tools: [{ name: 'search_page', description: 'd', parameters: {} }] }, new AbortController().signal));
    expect(out).toContainEqual({ type: 'tool_call', call: { id: 'c1', name: 'search_page', arguments: '{"q":"x"}' } });
    expect(out.at(-1)).toMatchObject({ type: 'finish', reason: 'tool_calls' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'search_page', description: 'd', parameters: {} } });
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

  it('serializes tool turns in the OpenAI wire shape', () => {
    expect(toOpenAIMessages([
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'f', arguments: '{}' }] },
      { role: 'tool', content: 'result', tool_call_id: 'c1', name: 'f' },
    ])).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
      { role: 'tool', content: 'result', tool_call_id: 'c1', name: 'f' },
    ]);
  });
});
