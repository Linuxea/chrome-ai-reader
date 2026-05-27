import { describe, it, expect } from 'vitest';
import { stripMarkdown, splitToSegments, SENTENCE_ENDS } from '../../../src/side_panel/services/tts/utils.js';

describe('stripMarkdown', () => {
  it('removes code blocks', () => {
    expect(stripMarkdown('before ```code``` after')).toBe('before  after');
  });

  it('removes inline code markers but keeps text', () => {
    expect(stripMarkdown('use `foo()` to bar')).toBe('use foo() to bar');
  });

  it('removes links but keeps link text', () => {
    expect(stripMarkdown('click [here](https://example.com)')).toBe('click here');
  });

  it('image syntax: link regex runs first, leaving ! before alt text', () => {
    // Links are stripped before images, so ![alt](url) becomes !alt (not just alt)
    expect(stripMarkdown('see ![alt text](img.png)')).toBe('see !alt text');
  });

  it('removes heading markers', () => {
    expect(stripMarkdown('## Heading')).toBe('Heading');
  });

  it('removes bold markers', () => {
    expect(stripMarkdown('this is **bold** text')).toBe('this is bold text');
  });

  it('removes italic markers', () => {
    expect(stripMarkdown('this is *italic* text')).toBe('this is italic text');
  });

  it('removes bold __ markers', () => {
    expect(stripMarkdown('this is __bold__ text')).toBe('this is bold text');
  });

  it('removes italic _ markers', () => {
    expect(stripMarkdown('this is _italic_ text')).toBe('this is italic text');
  });

  it('removes strikethrough markers', () => {
    expect(stripMarkdown('this is ~~deleted~~ text')).toBe('this is deleted text');
  });

  it('removes unordered list markers', () => {
    expect(stripMarkdown('- item1\n- item2')).toBe('item1\nitem2');
  });

  it('removes ordered list markers', () => {
    expect(stripMarkdown('1. first\n2. second')).toBe('first\nsecond');
  });

  it('removes blockquote markers', () => {
    expect(stripMarkdown('> quoted text')).toBe('quoted text');
  });

  it('trims result', () => {
    expect(stripMarkdown('  hello  ')).toBe('hello');
  });
});

describe('splitToSegments', () => {
  it('splits at every 5 sentence-ending punctuation marks', () => {
    // 5 English periods → one segment
    const text = 'One. Two. Three. Four. Five. Six.';
    const segments = splitToSegments(text);
    expect(segments.length).toBe(2);
    expect(segments[0]).toBe('One. Two. Three. Four. Five.');
    expect(segments[1]).toBe('Six.');
  });

  it('handles Chinese punctuation', () => {
    const text = '一。二。三。四。五。六。';
    const segments = splitToSegments(text);
    expect(segments.length).toBe(2);
    expect(segments[0]).toBe('一。二。三。四。五。');
    expect(segments[1]).toBe('六。');
  });

  it('handles mixed Chinese/English punctuation', () => {
    const text = 'Hello! World. 你好！测试。好的. 明白!';
    // Marks: ! . ！ 。 . ! → 6 marks → first segment has 5, second has 1
    const segments = splitToSegments(text);
    expect(segments.length).toBe(2);
  });

  it('returns remaining text as last segment', () => {
    const text = 'A. B. C.';
    const segments = splitToSegments(text);
    // Only 3 sentence ends (< 5), so one segment with everything
    expect(segments.length).toBe(1);
    expect(segments[0]).toBe('A. B. C.');
  });

  it('returns empty array for empty string', () => {
    expect(splitToSegments('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(splitToSegments('   ')).toEqual([]);
  });

  it('handles text with no sentence-ending punctuation', () => {
    expect(splitToSegments('no punctuation here')).toEqual(['no punctuation here']);
  });
});

describe('SENTENCE_ENDS', () => {
  it('contains expected punctuation characters', () => {
    expect(SENTENCE_ENDS).toContain('。');
    expect(SENTENCE_ENDS).toContain('！');
    expect(SENTENCE_ENDS).toContain('？');
    expect(SENTENCE_ENDS).toContain('.');
    expect(SENTENCE_ENDS).toContain('!');
    expect(SENTENCE_ENDS).toContain('?');
  });
});
