import { describe, it, expect, vi } from 'vitest';
import { extractParagraphs, paragraphsFromHtml, highlightParagraph } from '../../src/content/paragraphs';

describe('content/paragraphs', () => {
  it('collects leaf-most blocks in order, skipping nav/footer', () => {
    document.body.innerHTML = `
      <nav><p>Menu</p></nav>
      <article>
        <h1>Title</h1>
        <p>First   paragraph.</p>
        <ul><li><p>Nested item</p></li><li>Plain item</li></ul>
      </article>
      <footer><p>Footer</p></footer>`;
    expect(extractParagraphs(document.body)).toEqual(['Title', 'First paragraph.', 'Nested item', 'Plain item']);
  });

  it('parses Readability HTML inertly', () => {
    expect(paragraphsFromHtml('<div><p>A</p><img src="https://x/y.png"><p>B</p></div>')).toEqual(['A', 'B']);
  });

  it('highlightParagraph scrolls to and flashes the matching element', () => {
    document.body.innerHTML = '<p id="a">Alpha text</p><p id="b">Beta   text that is cited</p>';
    const b = document.getElementById('b')!;
    b.scrollIntoView = vi.fn();
    expect(highlightParagraph('Beta text that is cited')).toBe(true);
    expect(b.scrollIntoView).toHaveBeenCalled();
    expect(b.style.backgroundColor).not.toBe('');
    expect(highlightParagraph('Not on the page')).toBe(false);
  });
});
