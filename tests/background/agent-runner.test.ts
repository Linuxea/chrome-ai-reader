import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ChatMessage } from '../../src/shared/types';
import type { ToolSpec } from '../../src/background/providers/types';

/**
 * The agent tool loop on the Vercel AI SDK, driven by MockLanguageModelV4.
 * Wire shapes are spike-verified: tool-call `input` is a JSON string on the
 * provider stream, usage is nested ({inputTokens:{total}}), and the finish
 * reason is {unified, raw} — see the mock helpers below.
 */

const { posted } = vi.hoisted(() => ({ posted: [] as Record<string, unknown>[] }));
vi.mock('../../src/background/usage', () => ({ recordUsage: vi.fn() }));
vi.mock('../../src/background/sw-utils', () => ({ safePostMessage: (_p: unknown, m: Record<string, unknown>) => posted.push(m) }));
vi.mock('../../src/platform/settings', () => ({
  DEFAULT_API_BASE: 'https://api.deepseek.com',
  DEFAULT_ANTHROPIC_API_BASE: 'https://api.anthropic.com',
  readSettings: async () => ({}),
  readStoredSettings: async () => ({}),
}));
vi.mock('../../src/background/providers/anthropic', () => ({ supportsAdaptiveThinking: () => false }));

import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { streamAgentToPort, toModelMessages, AGENT_MAX_STEPS } from '../../src/background/agent-runner';
import { recordUsage } from '../../src/background/usage';

// ---------------------------------------------------------------------------
// mock model — scripted rounds
// ---------------------------------------------------------------------------

const usage = (i: number, o: number) => ({ inputTokens: { total: i }, outputTokens: { total: o } });

type Round = { kind: 'tools'; calls: { id: string; name: string; args: unknown }[] } | { kind: 'text'; text: string };

/** Model that plays the given rounds, recording every prompt it saw. */
function mockModel(rounds: Round[]): { model: MockLanguageModelV4; prompts: { role: string; content: unknown }[][] } {
  const prompts: { role: string; content: unknown }[][] = [];
  let call = -1;
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }: LanguageModelV4CallOptions) => {
      call++;
      prompts.push(prompt.map((m) => ({ role: m.role, content: m.content })));
      const round = rounds[Math.min(call, rounds.length - 1)];
      const parts: Record<string, unknown>[] = [{ type: 'stream-start', warnings: [] }];
      if (round.kind === 'tools') {
        parts.push({ type: 'reasoning-start', id: 'r0' }, { type: 'reasoning-delta', id: 'r0', delta: 'hmm ' }, { type: 'reasoning-end', id: 'r0' });
        for (const c of round.calls) {
          parts.push({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: JSON.stringify(c.args) });
        }
        parts.push({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: usage(10 + call, 5) });
      } else {
        parts.push({ type: 'text-start', id: 't0' }, { type: 'text-delta', id: 't0', delta: round.text }, { type: 'text-end', id: 't0' });
        parts.push({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(3, 2) });
      }
      return { stream: convertArrayToReadableStream(parts) };
    },
  });
  return { model, prompts };
}

function mockPort() {
  const msgListeners = new Set<(m: unknown) => void>();
  const discListeners = new Set<() => void>();
  return {
    onMessage: { addListener: (f: (m: unknown) => void) => msgListeners.add(f), removeListener: (f: (m: unknown) => void) => msgListeners.delete(f) },
    onDisconnect: { addListener: (f: () => void) => discListeners.add(f), removeListener: (f: () => void) => discListeners.delete(f) },
    send(m: unknown) { msgListeners.forEach((f) => f(m)); },
    disconnect() { discListeners.forEach((f) => f()); },
  } as unknown as chrome.runtime.Port & { send(m: unknown): void; disconnect(): void };
}

const TOOLS: ToolSpec[] = [
  { name: 'search_page', description: 'search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'read_paragraphs', description: 'read', parameters: { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } }, additionalProperties: false } },
];

/** Wait until the SW posted a tool_call for `id`, then answer as the panel. */
async function panelAnswers(port: chrome.runtime.Port & { send(m: unknown): void }, id: string, content: string, name = 'search_page'): Promise<void> {
  await vi.waitFor(() => {
    const found = posted.some((m) => m.type === 'tool_call' && (m.call as { id: string }).id === id);
    expect(found).toBe(true);
  });
  port.send({ type: 'tool_result', toolCallId: id, name, content });
}

beforeEach(() => {
  posted.length = 0;
  vi.mocked(recordUsage).mockClear();
});

describe('agent-runner streamAgentToPort', () => {
  it('relays tool calls per-call to the panel and streams the final answer', async () => {
    const { model, prompts } = mockModel([
      { kind: 'tools', calls: [{ id: 'c1', name: 'search_page', args: { query: 'budget' } }, { id: 'c2', name: 'read_paragraphs', args: { start: 0, end: 3 } }] },
      { kind: 'text', text: 'final answer' },
    ]);
    const port = mockPort();
    const history: ChatMessage[] = [
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'q' },
    ];

    const run = streamAgentToPort(port, { messages: history, tools: TOOLS }, { model, modelId: 'm1' });
    // Two parallel calls: answer both (completion order c2 → c1).
    await panelAnswers(port, 'c2', '[#0] a');
    await panelAnswers(port, 'c1', '[#3] budget');
    await run;

    const types = posted.map((m) => m.type);
    // Reasoning streams before the tool calls are parsed, so thinking may
    // precede the round marker; relative order of the rest is fixed.
    expect(types).toEqual(['thinking', 'agent_round', 'tool_call', 'tool_call', 'chunk', 'done']);
    expect(posted.find((m) => m.type === 'agent_round')).toEqual({ type: 'agent_round', round: 1 });
    expect(posted.find((m) => m.type === 'tool_call' && m.call.id === 'c1')!.call).toEqual({
      id: 'c1', name: 'search_page', arguments: '{"query":"budget"}',
    });
    expect(posted.find((m) => m.type === 'thinking')).toEqual({ type: 'thinking', content: 'hmm ' });
    expect(posted.at(-1)).toEqual({ type: 'done', finishReason: 'stop', usage: { inputTokens: 13, outputTokens: 7 }, model: 'm1' });
    expect(recordUsage).toHaveBeenCalledWith('m1', { inputTokens: 13, outputTokens: 7 });

    // Round 2 prompt: system went to instructions; the tool round-trip is
    // replayed as assistant tool-call parts + one merged tool message.
    expect(prompts).toHaveLength(2);
    expect(prompts[1][0].role).toBe('system');
    expect(prompts[1].filter((m) => m.role === 'tool')).toEqual([{
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'c1', toolName: 'search_page', output: { type: 'text', value: '[#3] budget' } },
        { type: 'tool-result', toolCallId: 'c2', toolName: 'read_paragraphs', output: { type: 'text', value: '[#0] a' } },
      ],
    }]);
  });

  it('announces a new round for a second tool step', async () => {
    const { model } = mockModel([
      { kind: 'tools', calls: [{ id: 'a', name: 'search_page', args: { query: '1' } }] },
      { kind: 'tools', calls: [{ id: 'b', name: 'search_page', args: { query: '2' } }] },
      { kind: 'text', text: 'ok' },
    ]);
    const port = mockPort();
    const run = streamAgentToPort(port, { messages: [{ role: 'user', content: 'q' }], tools: TOOLS }, { model, modelId: 'm' });
    await panelAnswers(port, 'a', 'r1');
    await panelAnswers(port, 'b', 'r2');
    await run;
    expect(posted.filter((m) => m.type === 'agent_round')).toEqual([{ type: 'agent_round', round: 1 }, { type: 'agent_round', round: 2 }]);
  });

  it('marks the step limit when every round asks for tools', async () => {
    const rounds: Round[] = Array.from({ length: AGENT_MAX_STEPS + 2 }, (_, i) => ({ kind: 'tools', calls: [{ id: `c${i}`, name: 'search_page', args: {} }] })) as Round[];
    const { model, prompts } = mockModel(rounds);
    const port = mockPort();
    const run = streamAgentToPort(port, { messages: [{ role: 'user', content: 'q' }], tools: TOOLS }, { model, modelId: 'm' });
    for (let i = 0; i < AGENT_MAX_STEPS; i++) await panelAnswers(port, `c${i}`, 'r');
    await run;
    expect(posted.at(-1)).toMatchObject({ type: 'done', finishReason: 'length', limit: 'steps', model: 'm' });
    expect(prompts).toHaveLength(AGENT_MAX_STEPS);
  });

  it('answers the model with an explanatory string when the panel never replies', async () => {
    vi.useFakeTimers();
    try {
      const { model, prompts } = mockModel([
        { kind: 'tools', calls: [{ id: 'c1', name: 'search_page', args: { query: 'x' } }] },
        { kind: 'text', text: 'gave up' },
      ]);
      const port = mockPort();
      const run = streamAgentToPort(port, { messages: [{ role: 'user', content: 'q' }], tools: TOOLS }, { model, modelId: 'm', toolTimeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(80);
      await run;
      const toolMsg = prompts[1].find((m) => m.role === 'tool') as { content: { type: string; output: { value: string } }[] };
      expect(toolMsg.content[0].output.value).toMatch(/did not answer within/i);
      expect(posted.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes silent when the panel disconnects mid-run', async () => {
    const { model } = mockModel([
      { kind: 'tools', calls: [{ id: 'c1', name: 'search_page', args: { query: 'x' } }] },
      { kind: 'text', text: 'never' },
    ]);
    const port = mockPort();
    const run = streamAgentToPort(port, { messages: [{ role: 'user', content: 'q' }], tools: TOOLS }, { model, modelId: 'm' });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'tool_call')).toBe(true));
    const before = posted.length;
    (port as unknown as { disconnect(): void }).disconnect();
    await run;
    expect(posted.length).toBe(before); // no done / error after the panel is gone
  });

  it('errors with a config key when no API key is set', async () => {
    // No deps.model → resolveAgentModel runs against the (empty) settings mock.
    await streamAgentToPort(mockPort(), { messages: [], tools: TOOLS });
    expect(posted).toEqual([{ type: 'error', errorKey: 'error.noApiKey' }]);
  });
});

describe('agent-runner toModelMessages', () => {
  it('splits the system message into instructions and converts tool turns', () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'f', arguments: '{"x":1}' }] },
      { role: 'tool', tool_call_id: 'c1', name: 'f', content: 'result' },
      { role: 'assistant', content: 'done' },
    ];
    const { instructions, messages } = toModelMessages(history);
    expect(instructions).toBe('sys');
    expect(messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'f', input: { x: 1 } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'f', output: { type: 'text', value: 'result' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]);
  });

  it('maps image parts and merges consecutive tool messages into one round', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }] },
      { role: 'assistant', content: '', tool_calls: [
        { id: 'a', name: 'f', arguments: '{}' },
        { id: 'b', name: 'g', arguments: '{}' },
      ] },
      { role: 'tool', tool_call_id: 'a', name: 'f', content: 'r1' },
      { role: 'tool', tool_call_id: 'b', name: 'g', content: 'r2' },
    ];
    const { messages } = toModelMessages(history);
    expect(messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'look' }, { type: 'image', image: 'data:image/png;base64,xx' }],
    });
    const toolMessages = messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect((toolMessages[0] as { content: unknown[] }).content).toHaveLength(2);
  });

  it('shortens tool results from rounds older than the last two (without mutating the input)', () => {
    const long = 'x'.repeat(800);
    const history: ChatMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'a', name: 'f', arguments: '{}' }] },
      { role: 'tool', tool_call_id: 'a', name: 'f', content: long },
      { role: 'assistant', content: '', tool_calls: [{ id: 'b', name: 'f', arguments: '{}' }] },
      { role: 'tool', tool_call_id: 'b', name: 'f', content: long },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c', name: 'f', arguments: '{}' }] },
      { role: 'tool', tool_call_id: 'c', name: 'f', content: long },
    ];
    const { messages } = toModelMessages(history);
    const contents = messages.filter((m) => m.role === 'tool').map((m) => (m as { content: { output: { value: string } }[] }).content[0].output.value);
    expect(contents[0]).toMatch(/\[earlier tool result omitted\]$/);
    expect(contents[0].length).toBeLessThanOrEqual(500 + 30);
    expect(contents[1]).toBe(long);
    expect(contents[2]).toBe(long);
    // The caller's history is untouched.
    expect(history[1].content).toBe(long);
  });

  it('tolerates malformed tool arguments instead of throwing', () => {
    const { messages } = toModelMessages([
      { role: 'assistant', content: 'text', tool_calls: [{ id: 'c', name: 'f', arguments: 'not json' }] },
    ]);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'text' }, { type: 'tool-call', toolCallId: 'c', toolName: 'f', input: {} }],
    });
  });
});
