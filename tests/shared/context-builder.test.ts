import { describe, it, expect } from 'vitest';
import { buildPageContext, splitParagraphs, scoreParagraphs, terms, trimHistory } from '../../src/shared/context-builder';
import type { ChatMessage } from '../../src/shared/types';

describe('context-builder splitParagraphs / terms', () => {
  it('splits on blank lines; a tiny fragment is joined with the paragraph after it', () => {
    expect(splitParagraphs('Title\n\nA long enough first paragraph of text here ok.\n\nshort\n\nAnother long enough paragraph here, fine.', 20))
      .toEqual(['Title A long enough first paragraph of text here ok.', 'short Another long enough paragraph here, fine.']);
  });

  it('falls back to single lines when there are no blank lines', () => {
    expect(splitParagraphs('line one is long enough\nline two is long enough', 5)).toEqual(['line one is long enough', 'line two is long enough']);
  });

  it('extracts latin words (minus stopwords) and CJK bigrams', () => {
    expect(terms('What is the RAG evaluation?')).toEqual(['rag', 'evaluation']);
    expect(terms('检索增强')).toEqual(['检索', '索增', '增强']);
  });
});

describe('context-builder buildPageContext', () => {
  const paras = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} about ordinary filler topics number ${i}.`);
  paras[150] = 'Paragraph 150 explains quantum entanglement experiments in detail.';

  it('includes everything, labelled, when within budget', () => {
    const ctx = buildPageContext(['a', 'b'], 'q');
    expect(ctx).toEqual({ text: '[#0] a\n\n[#1] b', partial: false, included: [0, 1] });
  });

  it('over budget: keeps the opening plus the relevant paragraph and its neighbours, marking gaps', () => {
    const ctx = buildPageContext(paras, 'quantum entanglement', 2000);
    expect(ctx.partial).toBe(true);
    expect(ctx.included).toContain(0);
    expect(ctx.included).toEqual(expect.arrayContaining([149, 150, 151]));
    expect(ctx.text).toContain('[#150] Paragraph 150 explains quantum');
    expect(ctx.text).toContain('…');
    expect(ctx.text.length).toBeLessThanOrEqual(2000 + 200);
  });

  it('without usable question terms, samples across the whole article (not just the head)', () => {
    const ctx = buildPageContext(paras, 'summarize', 3000);
    expect(Math.max(...ctx.included)).toBeGreaterThan(150);
  });

  it('scores CJK queries against CJK paragraphs', () => {
    const s = scoreParagraphs(['今天天气很好', '检索增强生成的评测方法', '无关内容'], '检索增强生成怎么评测');
    expect(s[1]).toBeGreaterThan(s[0]);
    expect(s[1]).toBeGreaterThan(s[2]);
  });
});

describe('context-builder trimHistory', () => {
  const m = (role: ChatMessage['role'], n: number): ChatMessage => ({ role, content: 'x'.repeat(n) });

  it('keeps the newest messages within budget and never starts on an assistant turn', () => {
    const history = [m('user', 100), m('assistant', 100), m('user', 100), m('assistant', 100), m('user', 100)];
    const { messages, dropped } = trimHistory(history, 250);
    expect(messages).toEqual(history.slice(4));
    expect(dropped).toBe(4);
  });

  it('keeps everything that fits', () => {
    const history = [m('user', 10), m('assistant', 10)];
    expect(trimHistory(history, 1000)).toEqual({ messages: history, dropped: 0 });
  });
});
