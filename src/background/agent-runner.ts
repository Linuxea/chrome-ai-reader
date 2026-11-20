/**
 * F11 agent mode — the tool loop on the Vercel AI SDK (`ai` + provider
 * packages). `streamText` owns what this file used to hand-roll: the
 * multi-step loop (stopWhen), parallel tool execution, per-step usage
 * accounting and provider tool-call normalization (OpenAI-compatible wire
 * vs Anthropic tool_use).
 *
 * The tools still RUN in the side panel — they need TabState (paragraphs,
 * selection) that only the panel holds. Each tool's `execute` therefore
 * relays the call over the ai-chat port (`tool_call` message) and resolves
 * when the panel posts the matching `tool_result`. Results may arrive
 * before the waiter registers (the panel starts working on the message,
 * not on execute()), so an early-result buffer backs the waiter map.
 *
 * Model wire notes (spike-verified against ai@7):
 * - system prompts go through `instructions`, never as a messages entry
 *   (InvalidPromptError otherwise);
 * - assistant tool turns are content parts `{type:'tool-call', input:object}`;
 *   tool results are `{role:'tool', content:[{type:'tool-result', ...}]}` —
 *   consecutive tool messages are merged into one per round;
 * - when stopWhen caps the loop, the run-level finishReason stays
 *   'tool-calls' with `steps.length` at the cap and tool calls pending in
 *   the last step — that is mapped to `length` + `limit:'steps'`.
 */

import { streamText, tool, jsonSchema, isStepCount } from 'ai';
import type { ModelMessage, AssistantContent, ToolSet } from 'ai';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { safePostMessage } from './sw-utils';
import { IDLE_TIMEOUT_MS } from './chat-runner';
import { readSettings, readStoredSettings, DEFAULT_API_BASE, DEFAULT_ANTHROPIC_API_BASE } from '../platform/settings';
import type { ChatMessage, ToolCall } from '../shared/types';
import type { FinishReason, TokenUsage } from '../shared/protocol';
import type { ToolSpec } from './providers/types';
import { supportsAdaptiveThinking } from './providers/anthropic';
import { recordUsage } from './usage';

/** Agent mode: model ↔ tools round trips per user turn. */
export const AGENT_MAX_STEPS = 6;
/** Give the panel this long to answer one tool_call before giving up on it. */
export const TOOL_RESULTS_TIMEOUT_MS = 120_000;
/** Cross-turn trimming: full results are kept for the last N rounds only. */
const TOOL_TRIM_KEEP_ROUNDS = 2;
const TOOL_TRIM_EXCERPT = 500;

export interface AgentRunOptions {
  messages: ChatMessage[];
  tools: ToolSpec[];
  temperature?: number;
}

/** Test seams: a pre-built model (MockLanguageModelV4) and a short relay timeout. */
export interface AgentRunDeps {
  model?: LanguageModelV4;
  modelId?: string;
  provider?: 'openai' | 'anthropic';
  toolTimeoutMs?: number;
}

type ResolvedModel = { ok: true; model: LanguageModelV4; modelId: string; anthropic: boolean } | { ok: false; errorKey: string };

/** Same settings → an AI SDK language model instead of a raw provider. */
async function resolveAgentModel(): Promise<ResolvedModel> {
  const [s, stored] = await Promise.all([
    readSettings(['provider', 'apiKey', 'modelName']),
    readStoredSettings(['apiBase']),
  ]);
  if (!s.apiKey) return { ok: false, errorKey: 'error.noApiKey' };
  if (!s.modelName) return { ok: false, errorKey: 'error.noModelName' };
  const anthropic = s.provider === 'anthropic';
  const apiBase = (stored.apiBase || (anthropic ? DEFAULT_ANTHROPIC_API_BASE : DEFAULT_API_BASE)).replace(/\/+$/, '');
  const model = anthropic
    ? createAnthropic({ apiKey: s.apiKey, baseURL: apiBase }).languageModel(s.modelName)
    : createOpenAICompatible({ name: 'reader', baseURL: apiBase, apiKey: s.apiKey }).languageModel(s.modelName);
  return { ok: true, model, modelId: s.modelName, anthropic };
}

// ---------------------------------------------------------------------------
// History conversion (ChatMessage[] → ModelMessage[])
// ---------------------------------------------------------------------------

function contentText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Shorten `role:'tool'` results from agent rounds older than the last
 * TOOL_TRIM_KEEP_ROUNDS (a round = one contiguous run of tool messages).
 * Operates on a copy — the panel's history must not be mutated through the
 * structured-clone boundary.
 */
function trimOldToolResults(messages: ChatMessage[]): ChatMessage[] {
  const rounds: number[][] = [];
  messages.forEach((m, i) => {
    if (m.role !== 'tool') return;
    if (rounds.length === 0 || messages[i - 1]?.role !== 'tool') rounds.push([]);
    rounds[rounds.length - 1].push(i);
  });
  const keep = new Set(rounds.slice(-TOOL_TRIM_KEEP_ROUNDS).flat());
  return messages.map((m, i) => {
    if (m.role !== 'tool' || keep.has(i) || typeof m.content !== 'string' || m.content.length <= TOOL_TRIM_EXCERPT) return m;
    return { ...m, content: m.content.slice(0, TOOL_TRIM_EXCERPT) + '\n[earlier tool result omitted]' };
  });
}

/** Our persisted history → AI SDK prompt shape. Exported for tests. */
export function toModelMessages(history: ChatMessage[]): { instructions?: string; messages: ModelMessage[] } {
  const messages = trimOldToolResults(history);
  const system: string[] = [];
  const out: ModelMessage[] = [];

  const flushToolRun = (run: { id: string; name: string; value: string }[]): void => {
    if (!run.length) return;
    out.push({
      role: 'tool',
      content: run.map((r) => ({
        type: 'tool-result' as const,
        toolCallId: r.id,
        toolName: r.name,
        output: { type: 'text' as const, value: r.value },
      })),
    });
  };

  let toolRun: { id: string; name: string; value: string }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      toolRun.push({ id: m.tool_call_id ?? '', name: m.name ?? '', value: typeof m.content === 'string' ? m.content : contentText(m.content) });
      continue;
    }
    flushToolRun(toolRun); toolRun = [];

    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : contentText(m.content);
      if (text) system.push(text);
    } else if (m.role === 'user') {
      const content = typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => p.type === 'text' ? { type: 'text' as const, text: p.text } : { type: 'image' as const, image: p.image_url.url });
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const parts: AssistantContent = [];
      const text = typeof m.content === 'string' ? m.content : contentText(m.content);
      if (text) parts.push({ type: 'text', text });
      for (const c of m.tool_calls ?? []) parts.push({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: parseArgs(c.arguments) });
      out.push({ role: 'assistant', content: parts.length ? parts : [{ type: 'text', text: '' }] });
    }
  }
  flushToolRun(toolRun);

  return { instructions: system.join('\n\n') || undefined, messages: out };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'content-filter': return 'refusal';
    case 'tool-calls': return 'tool_calls';
    default: return 'other';
  }
}

/**
 * Stream an agent chat to the port: `thinking` / `chunk` messages while
 * generating, `agent_round` + `tool_call` messages when the model requests
 * tools (the panel answers each with a `tool_result`), then exactly one
 * `done` or `error` — same contract as streamToPort.
 */
export async function streamAgentToPort(port: chrome.runtime.Port, opts: AgentRunOptions, deps: AgentRunDeps = {}): Promise<void> {
  let model = deps.model;
  let modelId = deps.modelId ?? '';
  let anthropic = deps.provider === 'anthropic';
  if (!model) {
    const resolved = await resolveAgentModel();
    if (!resolved.ok) { safePostMessage(port, { type: 'error', errorKey: resolved.errorKey }); return; }
    model = resolved.model; modelId = resolved.modelId; anthropic = resolved.anthropic;
  }

  const controller = new AbortController();
  let portGone = false;

  // --- relay: SW execute() ⇄ panel tool_result ------------------------------
  /** Results that arrived before their waiter registered (panel is fast). */
  const earlyResults = new Map<string, string>();
  const waiters = new Map<string, (v: string) => void>();
  /** Calls sent to the panel and not yet answered — keeps the idle watchdog
   * out of the tool phase (a slow tool has its own timeout, see below). */
  let relayPending = 0;

  const onPanelMessage = (msg: { type?: string; toolCallId?: string; content?: string }): void => {
    if (msg?.type !== 'tool_result' || !msg.toolCallId) return;
    relayPending = Math.max(0, relayPending - 1);
    const waiter = waiters.get(msg.toolCallId);
    if (waiter) { waiters.delete(msg.toolCallId); waiter(msg.content ?? ''); }
    else earlyResults.set(msg.toolCallId, msg.content ?? '');
  };
  port.onMessage.addListener(onPanelMessage);

  const toolTimeoutMs = deps.toolTimeoutMs ?? TOOL_RESULTS_TIMEOUT_MS;
  function awaitPanelResult(toolCallId: string): Promise<string> {
    const early = earlyResults.get(toolCallId);
    if (early !== undefined) { earlyResults.delete(toolCallId); return Promise.resolve(early); }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(toolCallId);
        resolve(`Tool did not answer within ${Math.round(toolTimeoutMs / 1000)}s (side panel unresponsive?).`);
      }, toolTimeoutMs);
      waiters.set(toolCallId, (v) => { clearTimeout(timer); resolve(v); });
    });
  }

  const toolSet: ToolSet = {};
  for (const spec of opts.tools) {
    toolSet[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema(spec.parameters as Parameters<typeof jsonSchema>[0]),
      execute: async (input, { toolCallId }) => {
        relayPending++;
        return awaitPanelResult(toolCallId);
      },
    });
  }

  // --- idle watchdog, deferred while tools run ------------------------------
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleFired = false;
  const idleKick = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // A tool round may legitimately outlast the model idle window — its
      // own timeout owns that phase; re-arm and check again later.
      if (relayPending > 0) { idleKick(); return; }
      idleFired = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };

  const onDisconnect = () => { portGone = true; controller.abort(); };
  port.onDisconnect.addListener(onDisconnect);

  const { instructions, messages } = toModelMessages(opts.messages);

  try {
    const result = streamText({
      model,
      instructions,
      messages,
      temperature: opts.temperature,
      tools: toolSet,
      stopWhen: isStepCount(AGENT_MAX_STEPS),
      abortSignal: controller.signal,
      ...(anthropic && supportsAdaptiveThinking(modelId)
        ? { providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } } }
        : {}),
    });

    let stepNo = 0;
    let announcedRound = 0;
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
        idleKick();
        if (part.type === 'text-delta') safePostMessage(port, { type: 'chunk', content: part.text });
        else safePostMessage(port, { type: 'thinking', content: part.text });
      } else if (part.type === 'start-step') {
        stepNo++;
        idleKick();
      } else if (part.type === 'tool-call' && !part.invalid) {
        // Post the call the moment it is parsed: the panel starts working
        // before execute() registers (earlyResults covers the race). The
        // round marker goes out once per LLM step that requests tools.
        if (stepNo > announcedRound) {
          announcedRound = stepNo;
          safePostMessage(port, { type: 'agent_round', round: stepNo });
        }
        const call: ToolCall = { id: part.toolCallId, name: part.toolName, arguments: JSON.stringify(part.input ?? {}) };
        safePostMessage(port, { type: 'tool_call', call });
      } else if (part.type === 'error') {
        safePostMessage(port, { type: 'error', error: (part.error as Error)?.message || String(part.error) });
        return;
      } else if (part.type === 'abort') {
        return;
      }
    }

    const steps = await result.steps;
    const rawUsage = await result.totalUsage;
    const finishReason = await result.finishReason;
    const usage: TokenUsage = { inputTokens: rawUsage.inputTokens ?? 0, outputTokens: rawUsage.outputTokens ?? 0 };

    // The stopWhen cap leaves the last step with unanswered tool calls —
    // report it as the step limit (the panel words it differently from a
    // token cut), mirroring the pre-AI-SDK runner.
    const lastStep = steps[steps.length - 1];
    const hitStepLimit = steps.length >= AGENT_MAX_STEPS && (lastStep?.toolCalls?.length ?? 0) > 0;

    if (usage.inputTokens > 0 || usage.outputTokens > 0) recordUsage(modelId, usage);
    safePostMessage(port, {
      type: 'done',
      finishReason: hitStepLimit ? 'length' : mapFinishReason(finishReason),
      usage,
      model: modelId,
      ...(hitStepLimit ? { limit: 'steps' } : {}),
    });
  } catch (e) {
    if (portGone) return;
    if (idleFired) { safePostMessage(port, { type: 'error', errorKey: 'error.streamTimeout' }); return; }
    safePostMessage(port, { type: 'error', error: (e as Error).message });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    port.onMessage.removeListener(onPanelMessage);
    port.onDisconnect.removeListener(onDisconnect);
  }
}
