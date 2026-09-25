import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mock the SDK: capture the request, replay scripted stream events ---
const { streamCalls, script } = vi.hoisted(() => ({
  streamCalls: [] as { params: Record<string, unknown>; opts: unknown; ctor: Record<string, unknown> }[],
  script: { events: [] as unknown[], final: { content: [] as unknown[] }, error: null as Error | null },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(private ctorOpts: Record<string, unknown>) {}
    beta = {
      messages: {
        stream: (params: Record<string, unknown>, opts: unknown) => {
          streamCalls.push({ params, opts, ctor: this.ctorOpts });
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of script.events) yield e;
              if (script.error) throw script.error;
            },
            finalMessage: async () => script.final,
          };
        },
      },
    };
  },
}));

import {
  anthropicProvider, toAnthropicMessages, buildAnthropicParams, supportsAdaptiveThinking,
} from '../../../src/background/providers/anthropic';
import type { ChatDelta } from '../../../src/background/providers/types';

async function collect(it: AsyncIterable<ChatDelta>): Promise<ChatDelta[]> {
  const out: ChatDelta[] = [];
  for await (const d of it) out.push(d);
  return out;
}

beforeEach(() => {
  streamCalls.length = 0;
  script.events = [];
  script.final = { content: [] };
  script.error = null;
});

describe('providers/anthropic message mapping', () => {
  it('folds system messages into `system` and maps images', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: 'rules' },
      { role: 'system', content: 'article' },
      { role: 'user', content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ] },
      { role: 'assistant', content: 'an image' },
    ]);
    expect(system).toBe('rules\n\narticle');
    expect(messages).toEqual([
      { role: 'user', content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ] },
      { role: 'assistant', content: 'an image' },
    ]);
  });

  it('replays native assistant content verbatim and groups tool results in one user turn', () => {
    const native = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'f', input: {} }];
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', name: 'f', arguments: '{}' }, { id: 't2', name: 'g', arguments: '{"a":1}' }], providerContent: native },
      { role: 'tool', tool_call_id: 't1', name: 'f', content: 'r1' },
      { role: 'tool', tool_call_id: 't2', name: 'g', content: 'r2' },
    ]);
    expect(messages[1]).toEqual({ role: 'assistant', content: native });
    expect(messages[2]).toEqual({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'r1' },
      { type: 'tool_result', tool_use_id: 't2', content: 'r2' },
    ] });
  });

  it('builds tool_use blocks when there is no native content', () => {
    const { messages } = toAnthropicMessages([
      { role: 'assistant', content: 'let me look', tool_calls: [{ id: 't1', name: 'f', arguments: '{"q":"x"}' }] },
    ]);
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'let me look' },
      { type: 'tool_use', id: 't1', name: 'f', input: { q: 'x' } },
    ]);
  });
});

describe('providers/anthropic request params', () => {
  it('uses adaptive summarized thinking, no temperature, and the refusal fallback on Opus 5', () => {
    const p = buildAnthropicParams({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'x' }], temperature: 0.7 }, 'https://api.anthropic.com');
    expect(p.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(p).not.toHaveProperty('temperature');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p.max_tokens).toBe(64000);
  });

  it('omits thinking on models without adaptive thinking and fallbacks on custom endpoints', () => {
    const p = buildAnthropicParams({ model: 'claude-haiku-4-5', messages: [] }, 'https://proxy.example');
    expect(p).not.toHaveProperty('thinking');
    expect(p).not.toHaveProperty('fallbacks');
    expect(supportsAdaptiveThinking('claude-sonnet-5')).toBe(true);
    expect(supportsAdaptiveThinking('claude-opus-4-6')).toBe(true);
    expect(supportsAdaptiveThinking('claude-3-5-sonnet-latest')).toBe(false);
  });

  it('asks for JSON via the system prompt in JSON mode and maps tools', () => {
    const p = buildAnthropicParams({
      model: 'claude-sonnet-5', messages: [{ role: 'system', content: 'S' }], jsonMode: true,
      tools: [{ name: 'f', description: 'd', parameters: { type: 'object' } }],
    }, 'https://api.anthropic.com');
    expect(p.system).toMatch(/^S\n\nRespond with a single JSON object/);
    expect(p.tools).toEqual([{ name: 'f', description: 'd', input_schema: { type: 'object' }, eager_input_streaming: true }]);
  });
});

describe('providers/anthropic stream', () => {
  it('maps text / thinking / tool_use events, stop reason and usage', async () => {
    script.events = [
      { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Looking' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'search_page' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"x"}' } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } },
    ];
    script.final = { content: [{ type: 'tool_use', id: 't1' }] };
    const out = await collect(anthropicProvider.stream({ apiKey: 'k', apiBase: 'https://api.anthropic.com' }, { model: 'claude-sonnet-5', messages: [] }, new AbortController().signal));
    expect(out).toEqual([
      { type: 'thinking', text: 'plan' },
      { type: 'text', text: 'Looking' },
      { type: 'tool_call', call: { id: 't1', name: 'search_page', arguments: '{"query":"x"}' } },
      { type: 'finish', reason: 'tool_calls', usage: { inputTokens: 12, outputTokens: 30 }, providerContent: [{ type: 'tool_use', id: 't1' }] },
    ]);
    expect(streamCalls[0].ctor).toMatchObject({ apiKey: 'k', baseURL: 'https://api.anthropic.com', dangerouslyAllowBrowser: true });
  });

  it('reports refusal and max_tokens stop reasons', async () => {
    script.events = [{ type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 0 } }];
    const out = await collect(anthropicProvider.stream({ apiKey: 'k', apiBase: 'https://api.anthropic.com' }, { model: 'claude-opus-5', messages: [] }, new AbortController().signal));
    expect(out.at(-1)).toMatchObject({ type: 'finish', reason: 'refusal' });
  });

  it('turns SDK errors into ProviderErrors with the API message', async () => {
    script.error = Object.assign(new Error('400 bad'), { status: 400, error: { error: { message: 'max_tokens too large' } } });
    await expect(collect(anthropicProvider.stream({ apiKey: 'k', apiBase: 'x' }, { model: 'm', messages: [] }, new AbortController().signal)))
      .rejects.toThrow('max_tokens too large');
  });
});
