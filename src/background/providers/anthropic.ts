/**
 * Native Anthropic Messages API provider, via the official SDK
 * (@anthropic-ai/sdk) running in the service worker.
 *
 * - The user brings their own key, stored only on this device
 *   (platform/settings), so browser-side use is intended here —
 *   `dangerouslyAllowBrowser` acknowledges that (the SDK adds the direct
 *   browser access header itself).
 * - `system` messages fold into the top-level `system` field.
 * - No `temperature` (current models reject sampling params) and no
 *   assistant prefill.
 * - Adaptive thinking with summarized display on models that support it, so
 *   the panel's thinking block has something to show.
 * - Opus 5 / Fable 5.1 on the Claude API opt into server-side refusal
 *   fallbacks (`fallbacks: "default"`).
 * - Tool loops: the assistant turn's native content (thinking + tool_use
 *   blocks) is returned as `providerContent` and replayed unchanged.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, MessageContentPart, ToolCall } from '../../shared/types';
import type { FinishReason, TokenUsage } from '../../shared/protocol';
import type { ChatDelta, ChatProvider, ChatRequest, ProviderConfig } from './types';
import { ProviderError } from './types';

type Block = Record<string, unknown>;
type Message = { role: 'user' | 'assistant'; content: string | Block[] };

const DATA_URI = /^data:([^;,]+);base64,(.*)$/s;

function imageBlock(url: string): Block {
  const m = DATA_URI.exec(url);
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  return { type: 'image', source: { type: 'url', url } };
}

function userContent(content: string | MessageContentPart[]): string | Block[] {
  if (typeof content === 'string') return content;
  return content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : imageBlock(p.image_url.url)));
}

function textOf(content: ChatMessage['content']): string {
  return typeof content === 'string' ? content : content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
}

/** Map provider-neutral history to Anthropic's `system` + `messages`. */
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: Message[] } {
  const system: string[] = [];
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === 'system') { system.push(textOf(m.content)); continue; }
    if (m.role === 'tool') {
      const block: Block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: textOf(m.content) };
      const last = out[out.length - 1];
      // All results of one assistant turn go back in a single user message.
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (m.role === 'assistant') {
      if (Array.isArray(m.providerContent)) { out.push({ role: 'assistant', content: m.providerContent as Block[] }); continue; }
      if (m.tool_calls?.length) {
        const blocks: Block[] = [];
        const text = textOf(m.content);
        if (text) blocks.push({ type: 'text', text });
        for (const c of m.tool_calls) {
          let input: unknown = {};
          try { input = JSON.parse(c.arguments || '{}'); } catch { /* keep {} */ }
          blocks.push({ type: 'tool_use', id: c.id, name: c.name, input });
        }
        out.push({ role: 'assistant', content: blocks });
        continue;
      }
      out.push({ role: 'assistant', content: textOf(m.content) });
      continue;
    }
    out.push({ role: 'user', content: userContent(m.content) });
  }
  return { system: system.filter(Boolean).join('\n\n'), messages: out };
}

/** Models that take `thinking: {type: "adaptive"}` (4.6+ Opus/Sonnet, 5.x, Fable, Mythos). */
export function supportsAdaptiveThinking(model: string): boolean {
  return /(opus|sonnet)-4-[6-9]|(opus|sonnet)-[5-9]|fable|mythos/.test(model);
}

/** Models for which the server-side refusal fallback chain is enabled by default. */
function usesRefusalFallback(model: string, apiBase: string): boolean {
  return /api\.anthropic\.com/.test(apiBase) && /^claude-(opus-5|fable-5-1)$/.test(model);
}

function maxTokensFor(model: string): number {
  return /claude-3/.test(model) ? 8192 : 64000;
}

function mapStop(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'end_turn': case 'stop_sequence': return 'stop';
    case 'max_tokens': case 'model_context_window_exceeded': return 'length';
    case 'tool_use': return 'tool_calls';
    case 'refusal': return 'refusal';
    default: return 'other';
  }
}

/** Build the Messages API request body. Exported for tests. */
export function buildAnthropicParams(req: ChatRequest, apiBase: string): Record<string, unknown> {
  const { system, messages } = toAnthropicMessages(req.messages);
  const params: Record<string, unknown> = { model: req.model, max_tokens: maxTokensFor(req.model), messages };
  const sys = req.jsonMode ? [system, 'Respond with a single JSON object and nothing else.'].filter(Boolean).join('\n\n') : system;
  if (sys) params.system = sys;
  if (supportsAdaptiveThinking(req.model)) params.thinking = { type: 'adaptive', display: 'summarized' };
  if (req.tools?.length) {
    params.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true }));
  }
  if (usesRefusalFallback(req.model, apiBase)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

export const anthropicProvider: ChatProvider = {
  async *stream(config: ProviderConfig, req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta> {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.apiBase, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const params = buildAnthropicParams(req, config.apiBase);

    let stream: ReturnType<typeof client.beta.messages.stream>;
    try {
      stream = client.beta.messages.stream(params as unknown as Parameters<typeof client.beta.messages.stream>[0], { signal });
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }

    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    const calls: ToolCall[] = [];
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let stop: string | null = null;

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            usage = { inputTokens: event.message.usage?.input_tokens ?? 0, outputTokens: event.message.usage?.output_tokens ?? 0 };
            break;
          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              toolBlocks.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '' });
            }
            break;
          case 'content_block_delta': {
            const d = event.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
            if (d.type === 'text_delta' && d.text) yield { type: 'text', text: d.text };
            else if (d.type === 'thinking_delta' && d.thinking) yield { type: 'thinking', text: d.thinking };
            else if (d.type === 'input_json_delta' && d.partial_json) {
              const b = toolBlocks.get(event.index);
              if (b) b.json += d.partial_json;
            }
            break;
          }
          case 'content_block_stop': {
            const b = toolBlocks.get(event.index);
            if (b) calls.push({ id: b.id, name: b.name, arguments: b.json || '{}' });
            break;
          }
          case 'message_delta':
            stop = event.delta.stop_reason ?? stop;
            if (event.usage?.output_tokens != null) usage = { ...usage, outputTokens: event.usage.output_tokens };
            break;
        }
      }
    } catch (e) {
      if (signal.aborted) throw e;
      const err = e as { status?: number; message?: string; error?: { error?: { message?: string } } };
      throw new ProviderError(err.error?.error?.message || err.message || 'Anthropic API error', err.status);
    }

    let providerContent: unknown;
    try { providerContent = (await stream.finalMessage()).content; } catch { /* stream ended without a message */ }
    for (const call of calls) yield { type: 'tool_call', call };
    yield { type: 'finish', reason: mapStop(stop), usage, providerContent };
  },
};

/** List model ids (options page "refresh models"). */
export async function listAnthropicModels(apiKey: string, apiBase: string): Promise<string[]> {
  const client = new Anthropic({ apiKey, baseURL: apiBase, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const ids: string[] = [];
  for await (const model of client.models.list()) ids.push(model.id);
  return ids;
}
