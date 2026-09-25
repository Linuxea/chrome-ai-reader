import { describe, it, expect } from 'vitest';
import { isPdfUrl, pageText, pdfParagraphs } from '../../src/shared/pdf-text';

describe('isPdfUrl', () => {
  it('matches .pdf paths on http(s) and file URLs', () => {
    expect(isPdfUrl('https://arxiv.org/pdf/2401.00001.pdf')).toBe(true);
    expect(isPdfUrl('https://x.com/a/Paper.PDF?download=1#page=2')).toBe(true);
    expect(isPdfUrl('file:///home/me/notes.pdf')).toBe(true);
  });
  it('rejects other URLs', () => {
    expect(isPdfUrl('https://x.com/pdf-guide')).toBe(false);
    expect(isPdfUrl('https://x.com/?f=a.pdf')).toBe(false);
    expect(isPdfUrl('chrome://settings/a.pdf')).toBe(false);
    expect(isPdfUrl('')).toBe(false);
  });
});

describe('pageText', () => {
  it('joins items and breaks at end-of-line markers', () => {
    expect(pageText([{ str: 'Hello', hasEOL: false }, { str: ' world', hasEOL: true }, { str: 'next ', hasEOL: true }])).toBe('Hello world\nnext');
  });
});

describe('pdfParagraphs', () => {
  it('re-joins hard-wrapped lines and splits at blank lines', () => {
    const page = 'The quick brown fox jumps over the lazy\ndog and keeps running far away.\n\nSecond block starts here and it\ncontinues.';
    expect(pdfParagraphs([page])).toEqual([
      'The quick brown fox jumps over the lazy dog and keeps running far away.',
      'Second block starts here and it continues.',
    ]);
  });
  it('ends a paragraph at a short line with closing punctuation', () => {
    const page = 'A long line of text that fills the whole column width here\nends here.\nAnother long line of text that fills the column width too\nand ends.';
    expect(pdfParagraphs([page])).toHaveLength(2);
  });
  it('re-joins hyphenated words and CJK without spaces', () => {
    expect(pdfParagraphs(['An extra-\nordinary infor-\nmation sample line that is long'])).toEqual(['An extraordinary information sample line that is long']);
    expect(pdfParagraphs(['这是第一行文字很长很长很长很长\n继续'])).toEqual(['这是第一行文字很长很长很长很长继续']);
  });
  it('keeps pages apart and skips empty ones', () => {
    expect(pdfParagraphs(['Page one text.', '', 'Page two text.'])).toEqual(['Page one text.', 'Page two text.']);
  });
});
