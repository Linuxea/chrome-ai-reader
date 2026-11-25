/**
 * OpenAI-compatible Chat Completions provider (DeepSeek, OpenAI, Ollama's
 * /v1, vLLM, Volcengine Ark, Gemini's OpenAI endpoint, …): streamed SSE via
 * fetch, parsed with shared/sse.ts.
 *
 * Capability downgrades are remembered per apiBase+model (capabilities.ts):
 * a provider that rejects `response_format` or `stream_options` gets the
 * request retried without it, once, and never sees the field again.
 *
 * F15 web search: `req.webSearch` declares DeepSeek's server-side
 * `deepseek_web_search` tool. Search progress streams back as
 * `server_tool_event` chunks (→ `search_event` deltas); the complete call
 * list and the citations arrive on the chunk that carries `finish_reason`
 * (→ `finish.web`). No probing or downgrade here: this build targets
 * `deepseek-flash`, which accepts the tool.
 */

import { createSSEParser } from '../../shared/sse';
import { buildWebResult, parseServerToolEvent } from '../../shared/web-search';
import type { ChatMessage, MessageContentPart, WebResult } from '../../shared/types';
import type { FinishReason, TokenUsage } from '../../shared/protocol';
import type { ChatDelta, ChatProvider, ChatRequest, ProviderConfig } from './types';
import { ProviderError } from './types';
import { hasCapabilityIssue, markCapabilityIssue, type Capability } from './capabilities';

/** OpenAI wire message. */
type WireMessage = {
  role: string;
  content: string | MessageContentPart[] | null;
};

export function toOpenAIMessages(messages: ChatMessage[]): WireMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** DeepSeek's server-side web search tool — declaring it lets the model search; it does not make it search. */
export const WEB_SEARCH_TOOL = { type: 'deepseek_web_search' } as const;

/**
 * F15: add the two messages that go with a web search declaration.
 * - the rule becomes its own system message right after the leading system
 *   messages (appending it to the article message would bury it under tens
 *   of thousands of characters);
 * - the `latest_reminder` goes directly before the LAST message, and only
 *   when that is the user message — the API rejects a reminder that is not
 *   immediately followed by one (400).
 */
export function withWebSearch(messages: WireMessage[], web: ChatRequest['webSearch']): WireMessage[] {
  if (!web) return messages;
  const out = [...messages];
  let head = 0;
  while (head < out.length && out[head].role === 'system') head++;
  out.splice(head, 0, { role: 'system', content: web.rule });
  if (out[out.length - 1]?.role === 'user') out.splice(out.length - 1, 0, { role: 'latest_reminder', content: web.reminder });
  return out;
}

function mapFinish(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
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
      /** F15 (DeepSeek): complete server-side tool calls, on the chunk that carries `finish_reason`. */
      server_tool_calls?: unknown;
      /** F15 (DeepSeek): `url_citation` items, code-point ranges into `content`. */
      annotations?: unknown;
    };
    finish_reason?: string | null;
    /** F15 (DeepSeek): progress of a server-side tool call; these chunks carry no `delta`. */
    server_tool_event?: unknown;
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
        messages: withWebSearch(toOpenAIMessages(req.messages), req.webSearch),
        stream: true,
        temperature: req.temperature ?? 0.7,
      };
      if (req.jsonMode && !hasCapabilityIssue(key, 'jsonMode')) { body.response_format = { type: 'json_object' }; sent.push('jsonMode'); }
      if (!hasCapabilityIssue(key, 'streamUsage')) { body.stream_options = { include_usage: true }; sent.push('streamUsage'); }
      // F15: declaring the web tool lets the model search; it does not make
      // it search. Nothing else changes: `temperature` and the sampling
      // params are simply ignored while it is declared.
      if (req.webSearch) body.tools = [WEB_SEARCH_TOOL];
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
    let finish: FinishReason | null = null;
    let usage: TokenUsage | undefined;
    let sawDone = false;
    let web: WebResult | undefined;

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
      // F15: search progress. These chunks have no delta at all — skipping
      // them (as before) would leave the runner's idle watchdog unkicked
      // for the whole search. Malformed events are dropped by the parser.
      if (choice.server_tool_event !== undefined) {
        const event = parseServerToolEvent(choice.server_tool_event);
        if (event) yield { type: 'search_event', event };
      }
      const d = choice.delta;
      const reasoning = d?.reasoning_content ?? d?.reasoning;
      if (reasoning) yield { type: 'thinking', text: reasoning };
      if (d?.content) yield { type: 'text', text: d.content };
      if (choice.finish_reason) {
        finish = mapFinish(choice.finish_reason);
        // F15: the complete tool calls + citations ride once on this chunk.
        web = buildWebResult(d?.server_tool_calls, d?.annotations) ?? web;
      }
    };

    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) yield* handle(ev.data);
    }
    if (!sawDone) for (const ev of parser.flush()) yield* handle(ev.data);

    yield { type: 'finish', reason: finish ?? 'stop', usage, ...(web ? { web } : {}) };
  },
};
