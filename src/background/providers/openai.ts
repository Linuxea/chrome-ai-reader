/**
 * OpenAI-compatible Chat Completions provider (DeepSeek, OpenAI, Ollama's
 * /v1, vLLM, Volcengine Ark, Gemini's OpenAI endpoint, …): streamed SSE via
 * fetch, parsed with shared/sse.ts.
 *
 * Capability downgrades are remembered per apiBase+model (capabilities.ts):
 * a provider that rejects `response_format` or `stream_options` gets the
 * request retried without it, once, and never sees the field again.
 */

import { createSSEParser } from '../../shared/sse';
import type { ChatMessage, MessageContentPart, ToolCall } from '../../shared/types';
import type { FinishReason, TokenUsage } from '../../shared/protocol';
import type { ChatDelta, ChatProvider, ChatRequest, ProviderConfig } from './types';
import { ProviderError } from './types';
import { hasCapabilityIssue, markCapabilityIssue, type Capability } from './capabilities';

/** OpenAI wire message (tool_calls in the nested `function` form). */
type WireMessage = {
  role: string;
  content: string | MessageContentPart[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

export function toOpenAIMessages(messages: ChatMessage[]): WireMessage[] {
  return messages.map((m) => {
    const out: WireMessage = { role: m.role, content: m.content };
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
      if (out.content === '') out.content = null;
    }
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    return out;
  });
}

function mapFinish(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': case 'function_call': return 'tool_calls';
    case 'content_filter': return 'refusal';
    default: return 'other';
  }
}

interface ChunkJSON {
  error?: { message?: string } | string;
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      /** Some providers (OpenRouter, vLLM) name it `reasoning`. */
      reasoning?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

async function request(config: ProviderConfig, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  const res = await fetch(`${config.apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  return res;
}

async function errorMessage(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
  const msg = typeof data.error === 'string' ? data.error : data.error?.message;
  return msg || `API request failed (${res.status})`;
}

/** Which optional field a 400 message complains about, if any. */
function rejectedField(message: string, sent: Capability[]): Capability | null {
  if (sent.includes('jsonMode') && /response_format|json_object|json mode/i.test(message)) return 'jsonMode';
  if (sent.includes('streamUsage') && /stream_options|include_usage/i.test(message)) return 'streamUsage';
  return null;
}

export const openaiProvider: ChatProvider = {
  async *stream(config: ProviderConfig, req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta> {
    const key = `${config.apiBase}|${req.model}`;
    const build = (): { body: Record<string, unknown>; sent: Capability[] } => {
      const sent: Capability[] = [];
      const body: Record<string, unknown> = {
        model: req.model,
        messages: toOpenAIMessages(req.messages),
        stream: true,
        temperature: req.temperature ?? 0.7,
      };
      if (req.jsonMode && !hasCapabilityIssue(key, 'jsonMode')) { body.response_format = { type: 'json_object' }; sent.push('jsonMode'); }
      if (!hasCapabilityIssue(key, 'streamUsage')) { body.stream_options = { include_usage: true }; sent.push('streamUsage'); }
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      }
      return { body, sent };
    };

    let attempt = build();
    let res = await request(config, attempt.body, signal);
    // Downgrade loop: each retry drops one field the provider rejected.
    for (let i = 0; !res.ok && res.status === 400 && i < 2; i++) {
      const msg = await errorMessage(res);
      const field = rejectedField(msg, attempt.sent);
      if (!field) throw new ProviderError(msg, res.status);
      markCapabilityIssue(key, field);
      attempt = build();
      res = await request(config, attempt.body, signal);
    }
    if (!res.ok) throw new ProviderError(await errorMessage(res), res.status);
    if (!res.body) throw new ProviderError('Empty response body');

    const parser = createSSEParser();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let finish: FinishReason | null = null;
    let usage: TokenUsage | undefined;
    let sawDone = false;

    const handle = function* (data: string): Generator<ChatDelta> {
      if (data === '[DONE]') { sawDone = true; return; }
      let json: ChunkJSON;
      try {
        json = JSON.parse(data) as ChunkJSON;
      } catch {
        // Lenient servers separate events with single newlines, which the
        // SSE spec joins into one multi-line payload — take it line by line.
        if (data.includes('\n')) for (const line of data.split('\n')) yield* handle(line.trim());
        return;
      }
      // Some providers report failures mid-stream as a data payload.
      if (json.error) throw new ProviderError(typeof json.error === 'string' ? json.error : json.error.message || 'Stream error');
      if (json.usage && (json.usage.prompt_tokens != null || json.usage.completion_tokens != null)) {
        usage = { inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 };
      }
      const choice = json.choices?.[0];
      if (!choice) return;
      const d = choice.delta;
      const reasoning = d?.reasoning_content ?? d?.reasoning;
      if (reasoning) yield { type: 'thinking', text: reasoning };
      if (d?.content) yield { type: 'text', text: d.content };
      for (const tc of d?.tool_calls ?? []) {
        const cur = toolCalls.get(tc.index) ?? { id: '', name: '', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        toolCalls.set(tc.index, cur);
      }
      if (choice.finish_reason) finish = mapFinish(choice.finish_reason);
    };

    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) yield* handle(ev.data);
    }
    if (!sawDone) for (const ev of parser.flush()) yield* handle(ev.data);

    const calls: ToolCall[] = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    for (const call of calls) yield { type: 'tool_call', call };
    yield { type: 'finish', reason: finish ?? (calls.length ? 'tool_calls' : 'stop'), usage };
  },
};
