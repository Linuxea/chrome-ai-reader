import { vi, describe, it, expect, beforeEach } from 'vitest';
import { collectChunks, type CollectedChunk } from '../../src/content/annotation.js';

describe('content/annotation collectChunks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('collects <p> elements inside <article> as chunks in order', () => {
    document.body.innerHTML = `
      <article>
        <p>First paragraph with enough text to be considered content here.</p>
        <p>Second paragraph also has a good amount of text in it too.</p>
      </article>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain('First paragraph');
    expect(chunks[1].text).toContain('Second paragraph');
    expect(chunks[0].node.tagName).toBe('P');
  });

  it('prefers article/main/[role=main] containers, ignoring nav/footer/script', () => {
    document.body.innerHTML = `
      <nav><p>navigation text that should be ignored completely</p></nav>
      <main>
        <p>Main content paragraph one with enough text to qualify.</p>
        <p>Main content paragraph two with enough text as well here.</p>
      </main>
      <footer><p>footer text that should also be ignored here.</p></footer>
      <script>p('not real text')</script>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.text.startsWith('Main content'))).toBe(true);
  });

  it('skips paragraphs shorter than the minimum length', () => {
    document.body.innerHTML = `
      <article>
        <p>too short.</p>
        <p>This paragraph is long enough to be picked up as real content yes.</p>
      </article>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('long enough');
  });

  it('falls back to body paragraphs when no semantic container exists', () => {
    document.body.innerHTML = `
      <p>Standalone paragraph with enough text to count as content ok.</p>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(1);
  });

  it('produces empty list for a document with no paragraphs', () => {
    document.body.innerHTML = `<div>just a div</div>`;
    expect(collectChunks(document)).toEqual([]);
  });
});

import { findAndWrap } from '../../src/content/annotation.js';

describe('content/annotation findAndWrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('wraps an exact quote in a single text node', () => {
    const p = document.createElement('p');
    p.textContent = 'The model improved performance by thirty percent overall.';
    document.body.appendChild(p);

    const found = findAndWrap(p, 'thirty percent');
    expect(found).toBe(true);

    const mark = p.querySelector('mark.anno-mark');
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toBe('thirty percent');
  });

  it('wraps a quote spanning two adjacent text nodes', () => {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('The model improved perfor'));
    p.appendChild(document.createTextNode('mance by a lot.'));
    document.body.appendChild(p);

    const found = findAndWrap(p, 'performance');
    expect(found).toBe(true);
    expect(p.querySelector('mark.anno-mark')!.textContent).toBe('performance');
  });

  it('trims whitespace around the quote when locating', () => {
    const p = document.createElement('p');
    p.textContent = 'Some sentence.   performance is great here.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'performance is great')).toBe(true);
    expect(p.querySelector('mark.anno-mark')!.textContent).toBe('performance is great');
  });

  it('returns false and wraps nothing when quote not present', () => {
    const p = document.createElement('p');
    p.textContent = 'Nothing relevant here at all in this text.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'absent phrase')).toBe(false);
    expect(p.querySelector('mark.anno-mark')).toBeNull();
  });

  it('returns false for empty quote', () => {
    const p = document.createElement('p');
    p.textContent = 'Some real content text to test against here.';
    expect(findAndWrap(p, '')).toBe(false);
  });

  it('only wraps the first occurrence', () => {
    const p = document.createElement('p');
    p.textContent = 'great great great text that repeats the word great.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'great')).toBe(true);
    expect(p.querySelectorAll('mark.anno-mark')).toHaveLength(1);
  });
});
