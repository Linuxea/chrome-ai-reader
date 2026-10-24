/**
 * Tests for side_panel/ui/agent-trace.ts — the shared DOM pieces of the
 * F11 agent step list: live rendering (stream-handler) and restored history
 * (dom-helpers) both go through here.
 */
import { vi, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { translations } = vi.hoisted(() => ({
  translations: {
    'agent.step': '🔧 {tool} {args}',
    'agent.tool.search_page': '搜索页面',
    'agent.tool.read_tab': '读取标签页',
    'agent.round': '第 {n} 轮',
    'agent.trace': '查证过程（{n} 步）',
  } as Record<string, string>,
}));
vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key: string, params?: Record<string, string>) => {
    let text = translations[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, v);
    return text;
  },
}));

import {
  describeArgs, agentToolLabel, excerptResult, STEP_RESULT_EXCERPT,
  createAgentStepLine, attachStepResult, createAgentTraceBlock,
} from '../../../src/side_panel/ui/agent-trace';

describe('ui/agent-trace', () => {
  describe('describeArgs', () => {
    it('renders key=value pairs', () => {
      expect(describeArgs('{"query":"quantum","start":3}')).toBe('query=quantum start=3');
    });

    it('drops empty values and caps the summary at 80 chars', () => {
      expect(describeArgs('{"query":""}')).toBe('');
      const long = describeArgs(`{"query":"${'x'.repeat(200)}"}`);
      expect(long.length).toBe(81); // 80 + ellipsis
      expect(long.endsWith('…')).toBe(true);
    });

    it('returns an empty string for bad JSON', () => {
      expect(describeArgs('{oops')).toBe('');
      expect(describeArgs('')).toBe('');
    });
  });

  it('agentToolLabel falls back to the raw name for hallucinated tools', () => {
    expect(agentToolLabel('search_page')).toBe('搜索页面');
    // i18n returns the key itself for unknown tools — show the raw name instead.
    expect(agentToolLabel('hallucinated_tool')).toBe('hallucinated_tool');
  });

  it('excerptResult caps long results', () => {
    expect(excerptResult('short')).toBe('short');
    const capped = excerptResult('x'.repeat(STEP_RESULT_EXCERPT + 50));
    expect(capped.length).toBeLessThanOrEqual(STEP_RESULT_EXCERPT + 2);
    expect(capped.endsWith('…')).toBe(true);
  });

  it('attachStepResult toggles the excerpt on click', () => {
    const steps = document.createElement('div');
    const line = createAgentStepLine('search_page', 'query=x');
    steps.appendChild(line); // .after() needs a parent
    attachStepResult(line, 'what the tool returned');

    expect(line.classList.contains('expandable')).toBe(true);
    expect(line.textContent).toBe('🔧 搜索页面 query=x');

    line.click();
    const body = line.nextElementSibling as HTMLElement;
    expect(body.className).toBe('agent-step-result');
    expect(body.textContent).toBe('what the tool returned');

    line.click();
    expect(line.nextElementSibling).not.toBe(body);
  });

  it('createAgentTraceBlock renders collapsed, with round headers and done steps', () => {
    const block = createAgentTraceBlock([
      { name: 'search_page', args: 'query=x', result: 'found', round: 1 },
      { name: 'read_tab', args: '5', result: 'other page', round: 2 },
      { name: 'search_page', args: 'query=y', result: 'more', round: 2 },
    ]);

    expect(block.classList.contains('collapsed')).toBe(true);
    expect(block.querySelector('.agent-trace-toggle')?.textContent).toBe('查证过程（3 步）');

    const steps = block.querySelectorAll('.agent-step');
    expect(steps).toHaveLength(3);
    expect(steps[0].classList.contains('done')).toBe(true); // restored steps are finished

    // Round headers appear from round 2 on — exactly one divider here.
    const rounds = block.querySelectorAll('.agent-round');
    expect(rounds).toHaveLength(1);

    // Toggling opens the list; steps keep their expandable results.
    (block.querySelector('.agent-trace-toggle') as HTMLElement).click();
    expect(block.classList.contains('collapsed')).toBe(false);
    steps[0].click();
    expect((steps[0].nextElementSibling as HTMLElement).className).toBe('agent-step-result');
  });

  // jsdom cannot catch a missing CSS rule (the "popup never closes" gotcha):
  // assert statically that the collapse + expansion rules exist.
  it('defines the collapsed-trace and expandable-step CSS rules', () => {
    const css = readFileSync(resolve(__dirname, '../../../src/side_panel/message-bubble.css'), 'utf8');
    expect(css).toMatch(/\.agent-trace\.collapsed\s+\.agent-steps\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.agent-step\.expandable\s*\{/);
    expect(css).toMatch(/\.agent-step-result\s*\{/);
    expect(css).toMatch(/\.agent-round\s*\{/);
  });
});
