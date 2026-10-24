/**
 * F11 agent mode — the shared DOM pieces of the tool-step UI. Both the live
 * stream (services/stream-handler) and restored history messages
 * (ui/dom-helpers) render through here so the two stay identical: the same
 * step lines, the same expandable result excerpts, the same collapsed
 * "verification steps" block for reloaded chats.
 */

import { t } from '../../shared/i18n.js';
import type { AgentTraceStep } from '../../shared/types';

/** Max characters of a tool result kept for display and persistence. */
export const STEP_RESULT_EXCERPT = 600;

/** Localized tool label; falls back to the raw name for hallucinated tools. */
export function agentToolLabel(name: string): string {
  const key = `agent.tool.${name}`;
  const label = t(key);
  return label === key ? name : label;
}

/** Short human-readable argument summary for the step list ("query=x start=3"). */
export function describeArgs(json: string): string {
  try {
    const args = JSON.parse(json || '{}') as Record<string, unknown>;
    const parts = Object.entries(args)
      .map(([k, v]) => `${k}=${String(v)}`)
      .filter((s) => !s.endsWith('='));
    const text = parts.join(' ');
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  } catch {
    return '';
  }
}

/** The capped result excerpt stored in the trace / shown on expansion. */
export function excerptResult(result: string): string {
  return result.length > STEP_RESULT_EXCERPT ? result.slice(0, STEP_RESULT_EXCERPT) + '\n…' : result;
}

/** One "🔧 搜索页面 query=x" line. */
export function createAgentStepLine(name: string, argsSummary: string): HTMLElement {
  const line = document.createElement('div');
  line.className = 'agent-step';
  line.textContent = t('agent.step', { tool: agentToolLabel(name), args: argsSummary });
  return line;
}

/**
 * Make a finished step line expandable: clicking it reveals the excerpt of
 * what the tool returned — the audit/visibility entry point for tool results.
 */
export function attachStepResult(line: HTMLElement, result: string): void {
  const excerpt = excerptResult(result);
  if (!excerpt.trim()) return;
  line.classList.add('expandable');
  const body = document.createElement('div');
  body.className = 'agent-step-result';
  body.textContent = excerpt;
  let open = false;
  line.addEventListener('click', () => {
    open = !open;
    line.classList.toggle('open', open);
    if (open) line.after(body);
    else body.remove();
  });
}

/** "第 N 轮" divider between agent loop rounds (omitted for the first). */
export function createAgentRoundHeader(round: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'agent-round';
  el.textContent = t('agent.round', { n: String(round) });
  return el;
}

/**
 * The collapsed "查证过程" block prepended to a restored assistant message.
 * The evidence trail survives reloads instead of being stripped with the
 * live-DOM chrome (stripMessageChrome still removes the streaming-only
 * `.agent-steps` log; this block is rebuilt from the structured trace).
 */
export function createAgentTraceBlock(trace: AgentTraceStep[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'agent-trace collapsed';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'agent-trace-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = t('agent.trace', { n: String(trace.length) });
  const steps = document.createElement('div');
  steps.className = 'agent-steps';
  let lastRound = 0;
  for (const step of trace) {
    if (step.round > 1 && step.round !== lastRound) steps.appendChild(createAgentRoundHeader(step.round));
    lastRound = step.round;
    const line = createAgentStepLine(step.name, step.args);
    line.classList.add('done');
    steps.appendChild(line);
    attachStepResult(line, step.result);
  }
  toggle.addEventListener('click', () => {
    const collapsed = wrap.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  wrap.append(toggle, steps);
  return wrap;
}
