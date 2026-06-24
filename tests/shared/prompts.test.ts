/**
 * Guard tests for src/shared/prompts.ts — the single source of truth for LLM
 * prompts. These assert the *qualities* introduced in the 2026-06 prompt
 * redesign (grounding, bidirectional translate, verbatim-quote rule, depth
 * limit, zh-only podcast), so a future careless edit regresses loudly.
 */
import { describe, it, expect } from 'vitest';
import { getPrompt } from '../../src/shared/prompts';

describe('shared/prompts', () => {
  describe('getPrompt', () => {
    it('substitutes {custom} in the default rule prompt', () => {
      const out = getPrompt('default', 'zh', { custom: 'MyCustom' });
      expect(out).toContain('MyCustom');
      expect(out).not.toContain('{custom}');
    });

    it('substitutes {title}/{content} in the default.article prompt', () => {
      const out = getPrompt('default.article', 'zh', { title: 'MyTitle', content: 'BodyText' });
      expect(out).toContain('MyTitle');
      expect(out).toContain('BodyText');
      expect(out).not.toContain('{title}');
      expect(out).not.toContain('{content}');
    });

    it('leaves a blank line when {custom} is empty (no raw token leak)', () => {
      const out = getPrompt('default', 'zh', { custom: '' });
      expect(out).not.toContain('{custom}');
    });

    it('keeps the article OUT of the rule prompt', () => {
      // The rule message must be short and free of article text, so the custom
      // prompt is not buried under thousands of characters of content.
      const rules = getPrompt('default', 'zh', { custom: '' });
      expect(rules).not.toContain('【文章内容】');
      expect(rules).not.toContain('【文章标题】');
      const article = getPrompt('default.article', 'zh', { title: 'T', content: 'BODY' });
      expect(article).toContain('【文章内容】');
      expect(article).toContain('BODY');
    });

    it('the rule prompt is purely format/language (no grounding/content rules)', () => {
      // Rules must NOT dictate content judgments (no-fabrication, "not
      // mentioned", verbatim-quote) — those conflict with the user's custom
      // prompt and are weak anyway. Only format + language shells belong here.
      const zh = getPrompt('default', 'zh', { custom: '' });
      const en = getPrompt('default', 'en', { custom: '' });
      expect(zh).not.toMatch(/不要编造|超出文章范围|文章中未提及|原样引用|宁缺毋滥/);
      expect(en).not.toMatch(/do not fabricate|out of scope|not mentioned|verbatim/i);
    });

    it('pins the output language', () => {
      expect(getPrompt('default', 'zh', { custom: '' })).toContain('中文');
      expect(getPrompt('default', 'en', { custom: '' })).toMatch(/English/i);
    });

    it('requests Markdown formatting', () => {
      const zh = getPrompt('default', 'zh', { custom: '' });
      const en = getPrompt('default', 'en', { custom: '' });
      expect(zh).toMatch(/Markdown|无序列表/);
      expect(en).toMatch(/Markdown/i);
    });

    it('defaults to zh when lang is omitted', () => {
      expect(getPrompt('default', undefined, { custom: '' })).toContain('阅读助手');
    });

    it('falls back to zh when the en variant is missing (e.g. podcast)', () => {
      const en = getPrompt('podcast.system', 'en');
      const zh = getPrompt('podcast.system', 'zh');
      // podcast is intentionally zh-only — en must fall back to the zh text,
      // not return the raw key.
      expect(en).toBe(zh);
      expect(en).toContain('播客制作人');
    });

    it('normalizes any non-"en" lang string to zh', () => {
      expect(getPrompt('summarize.full', 'fr')).toBe(getPrompt('summarize.full', 'zh'));
      expect(getPrompt('summarize.full', '')).toBe(getPrompt('summarize.full', 'zh'));
    });
  });

  describe('translate prompts are bidirectional', () => {
    it('falls back to the other language when the source already matches the target', () => {
      // zh UI → target Chinese, but if already Chinese → translate to English
      const zh = getPrompt('translate.full', 'zh');
      expect(zh).toContain('中文');
      expect(zh).toMatch(/英文|英文/);
      expect(zh).toMatch(/若原文.*中文.*英文|已经是中文/);

      // en UI → target English, but if already English → translate to Chinese
      const en = getPrompt('translate.full', 'en');
      expect(en).toMatch(/English/i);
      expect(en).toMatch(/Chinese/i);
    });
  });

  describe('outline prompt', () => {
    it('limits nesting depth and demands verbatim quotes', () => {
      const zh = getPrompt('outline', 'zh');
      expect(zh).toMatch(/二级章节|children 必须为空数组|不要产生更深的层级/);
      expect(zh).toMatch(/原样|真实存在|不可改写/);

      const en = getPrompt('outline', 'en');
      expect(en).toMatch(/do not go deeper|children must be an empty array/i);
      expect(en).toMatch(/verbatim|never rewrite/i);
    });
  });

  describe('annotation system prompt', () => {
    it('defines the three perspectives', () => {
      const zh = getPrompt('annotation.system', 'zh');
      expect(zh).toContain('critique');
      expect(zh).toContain('counterpoint');
      expect(zh).toContain('flaw');
    });

    it('demands verbatim quotes and quality-over-quantity', () => {
      const zh = getPrompt('annotation.system', 'zh');
      expect(zh).toMatch(/原样|真实存在/);
      expect(zh).toContain('宁缺毋滥');

      const en = getPrompt('annotation.system', 'en');
      expect(en).toMatch(/verbatim|real contiguous/i);
      expect(en).toMatch(/quality over quantity|genuinely worthwhile/i);
    });
  });

  describe('suggest prompt', () => {
    it('asks for 3 non-closed questions, one per line', () => {
      const zh = getPrompt('suggest', 'zh');
      expect(zh).toMatch(/3 个/);
      expect(zh).toMatch(/每行一个|不要编号/);
      expect(zh).toMatch(/是\/否|封闭问题/);

      const en = getPrompt('suggest', 'en');
      expect(en).toMatch(/3 in-depth/i);
      expect(en).toMatch(/One question per line/i);
      expect(en).toMatch(/yes\/no/i);
    });
  });

  describe('podcast prompt', () => {
    it('specifies 20-25 rounds and the 50-280 char per-round limit', () => {
      const zh = getPrompt('podcast.system', 'zh');
      expect(zh).toMatch(/20-25 轮/);
      expect(zh).toMatch(/50-280 字/);
      expect(zh).toContain('交替发言');
    });

    it('demands the strict JSON rounds schema', () => {
      expect(getPrompt('podcast.system', 'zh')).toContain('"rounds"');
      expect(getPrompt('podcast.system', 'zh')).toMatch(/不要.*markdown|不要输出任何其他内容/);
    });
  });

  describe('quick-action prompts', () => {
    it('all six action prompt keys exist for both languages', () => {
      const keys = ['summarize.full', 'summarize.quote', 'translate.full', 'translate.quote', 'keyInfo.full', 'keyInfo.quote'] as const;
      for (const k of keys) {
        expect(getPrompt(k, 'zh').length).toBeGreaterThan(8);
        expect(getPrompt(k, 'en').length).toBeGreaterThan(8);
      }
    });

    it('quick-action prompts are terse (state the goal, not the process)', () => {
      // These ride on top of the default system message (which carries
      // grounding/language/format rules), so they must NOT restate those
      // generic rules — restating them is exactly what conflicts with the
      // user's custom prompt.
      for (const k of ['summarize.full', 'translate.full', 'keyInfo.full'] as const) {
        const zh = getPrompt(k, 'zh');
        const en = getPrompt(k, 'en');
        expect(zh).not.toMatch(/Markdown|无序列表|用中文回答/);
        expect(en).not.toMatch(/Markdown unordered|Reply in English/i);
      }
    });

    it('translate stays bidirectional despite being terse', () => {
      const zh = getPrompt('translate.full', 'zh');
      expect(zh).toMatch(/中文/);
      expect(zh).toMatch(/英文/);
      const en = getPrompt('translate.full', 'en');
      expect(en).toMatch(/English/i);
      expect(en).toMatch(/Chinese/i);
    });
  });
});
