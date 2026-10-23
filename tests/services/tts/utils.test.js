import { describe, it, expect } from 'vitest';
import {
  stripMarkdown, splitToSegments, createSegmentStream, nextCutEnd,
  SENTENCE_ENDS, FIRST_SEGMENT_CHARS, SEGMENT_CHARS, MAX_SEGMENT_CHARS,
} from '../../../src/side_panel/services/tts/utils.js';

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

  it('drops markdown table separator rows and reads cells as prose', () => {
    const table = [
      '| 名称 | 数量 |',
      '| --- | --- |',
      '| 苹果 | 三个 |',
    ].join('\n');
    const out = stripMarkdown(table);
    expect(out).not.toContain('|');
    expect(out).not.toContain('---');
    expect(out).toContain('名称');
    expect(out).toContain('苹果');
    expect(out).toContain('三个');
  });

  it('trims result', () => {
    expect(stripMarkdown('  hello  ')).toBe('hello');
  });
});

describe('nextCutEnd (greedy prefix rule)', () => {
  it('cuts after the first sentence end at/after the first-segment budget', () => {
    // 6 sentences of 10 chars: "0123456789." each
    const text = '0123456789.'.repeat(6);
    const cut = nextCutEnd(text, 0, true);
    expect(cut).toBe(66); // 60-char budget first met at the 6th sentence end (66)
  });

  it('uses the larger budget for later segments', () => {
    const text = '0123456789.'.repeat(40); // 440 chars
    const first = nextCutEnd(text, 0, true);
    const second = nextCutEnd(text, first, false);
    expect(second - first).toBeGreaterThanOrEqual(SEGMENT_CHARS);
    expect(second - first).toBeLessThanOrEqual(SEGMENT_CHARS + 11); // one sentence over
  });

  it('hard-cuts at MAX_SEGMENT_CHARS with no sentence end', () => {
    const text = 'x'.repeat(MAX_SEGMENT_CHARS + 50);
    expect(nextCutEnd(text, 0, true)).toBe(MAX_SEGMENT_CHARS);
  });

  it('returns -1 when nothing is complete yet', () => {
    expect(nextCutEnd('short.', 0, true)).toBe(-1); // 7 < FIRST_SEGMENT_CHARS
  });
});

describe('splitToSegments', () => {
  it('returns a single segment for text under the first budget', () => {
    const text = 'One. Two. Three. Four. Five. Six.';
    expect(splitToSegments(text)).toEqual([text]);
  });

  it('splits once the first budget is reached at a sentence end', () => {
    const sentence = '这是一句足够长的话呀。'; // 11 chars
    const text = sentence.repeat(12); // 132 chars
    const segments = splitToSegments(text);
    expect(segments.length).toBe(2);
    expect(segments[0].length).toBeGreaterThanOrEqual(FIRST_SEGMENT_CHARS);
    expect(segments[0].length).toBeLessThan(FIRST_SEGMENT_CHARS + sentence.length);
    expect(segments.join('')).toBe(text); // lossless
  });

  it('returns empty array for empty string', () => {
    expect(splitToSegments('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(splitToSegments('   ')).toEqual([]);
  });

  it('hard-cuts runs without sentence ends', () => {
    const text = 'y'.repeat(MAX_SEGMENT_CHARS * 2 + 10);
    const segments = splitToSegments(text);
    expect(segments.length).toBe(3);
    expect(segments[0].length).toBe(MAX_SEGMENT_CHARS);
    expect(segments.reduce((n, s) => n + s.length, 0)).toBe(text.length);
  });
});

describe('createSegmentStream — streaming cuts === batch cuts', () => {
  const fixtures = [
    'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.',
    '一。二。三。四。五。六。七。八。九。十。十一。十二。十三。十四。十五。十六。十七。十八。十九。二十。',
    'Hello! World. 你好！测试。好的. 明白! 这样就已经足够长了吧真的。' + '继续说很多很多的话。'.repeat(10),
    'no punctuation at all just words flowing on and on and on',
    'x'.repeat(1000), // hard-cut path
    'One. ```code block. with ends.``` Two. Three. Four. Five. Six. Seven. Enough words here.',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
  ];

  it.each(fixtures.map((text, i) => [i, text]))('fixture %i: incremental push === batch split', (_i, text) => {
    const stream = createSegmentStream();
    const streamed = [];
    // Feed in awkward chunk sizes to exercise partial boundaries
    for (let pos = 0; pos < text.length; pos += 7) {
      streamed.push(...stream.push(text.slice(pos, pos + 7)));
    }
    const tail = stream.end();
    if (tail) streamed.push(tail);

    expect(streamed).toEqual(splitToSegments(stripMarkdown(text)));
  });

  it('drops closed code fences before cutting', () => {
    const stream = createSegmentStream();
    const segs = stream.push('简短。```ignore me entirely.``` 完整的句子到这里就够了呀真的够长了。后面还有一句。');
    const tail = stream.end();
    const all = [...segs, ...(tail ? [tail] : [])];
    expect(all.join('')).not.toContain('ignore');
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
