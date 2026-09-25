import { describe, it, expect } from 'vitest';
import { hashText, locateQuote, highlightsToMarkdown, type Highlight } from '../../src/shared/highlights';

describe('shared/highlights', () => {
  it('hashText is stable and sensitive to content', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('locateQuote picks the occurrence whose context matches', () => {
    const text = 'the cat sat. then the cat ran. finally the cat slept.';
    expect(locateQuote(text, { exact: 'the cat', prefix: 'then ', suffix: ' ran' })).toBe(text.indexOf('the cat ran'));
    expect(locateQuote(text, { exact: 'the cat', prefix: 'finally ', suffix: '' })).toBe(text.indexOf('the cat slept'));
    expect(locateQuote(text, { exact: 'the dog', prefix: '', suffix: '' })).toBe(-1);
  });

  it('exports highlights as Markdown grouped by page', () => {
    const h = (id: string, url: string, exact: string, note = ''): Highlight =>
      ({ id, url, pageUrl: `https://${url}`, title: url.toUpperCase(), exact, prefix: '', suffix: '', note, createdAt: Number(id) });
    const md = highlightsToMarkdown([h('2', 'b', 'quote b'), h('1', 'a', 'quote a', 'my note')], 'Notes');
    // Ordered by creation: page A (created first) before page B.
    expect(md).toBe('# Notes\n\n## [A](https://a)\n\n> quote a\n\nmy note\n\n\n## [B](https://b)\n\n> quote b\n\n');
  });
});
