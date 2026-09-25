import { vi, describe, it, expect, beforeEach } from 'vitest';
import { buildTextIndex, selectorFromSelection, rangeFromSelector, paintHighlights } from '../../src/content/highlights';

beforeEach(() => {
  document.body.innerHTML = '<p>Alpha <b>bravo</b> charlie.</p><p>Delta bravo echo.</p><script>ignored()</script>';
});

describe('content/highlights', () => {
  it('flattens visible text, skipping scripts', () => {
    expect(buildTextIndex().text).toBe('Alpha bravo charlie.Delta bravo echo.');
  });

  it('captures a selection with context and re-anchors it across elements', () => {
    const range = document.createRange();
    const alpha = document.querySelector('p')!.firstChild as Text; // "Alpha "
    const charlie = document.querySelector('p')!.lastChild as Text; // " charlie."
    range.setStart(alpha, 2);
    range.setEnd(charlie, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const sel = selectorFromSelection(selection)!;
    expect(sel.exact).toBe('pha bravo ch');
    expect(sel.prefix).toBe('Al');
    expect(sel.suffix.startsWith('arlie.Delta')).toBe(true);

    const again = rangeFromSelector(sel)!;
    expect(again.toString()).toBe('pha bravo ch');
  });

  it('uses the context to choose between repeated quotes', () => {
    const r = rangeFromSelector({ exact: 'bravo', prefix: 'Delta ', suffix: '' })!;
    expect(r.startContainer.textContent).toBe('Delta bravo echo.');
  });

  it('paints nothing (and does not throw) without the Custom Highlight API', () => {
    expect(paintHighlights([{ id: '1', url: 'u', pageUrl: 'u', title: '', exact: 'bravo', prefix: '', suffix: '', note: '', createdAt: 0 }])).toBe(0);
  });

  it('paints found ranges through CSS.highlights when available', () => {
    const set = vi.fn();
    vi.stubGlobal('CSS', { highlights: { set, delete: vi.fn() } });
    vi.stubGlobal('Highlight', class { ranges: Range[]; constructor(...r: Range[]) { this.ranges = r; } });
    try {
      const n = paintHighlights([
        { id: '1', url: 'u', pageUrl: 'u', title: '', exact: 'charlie', prefix: '', suffix: '', note: '', createdAt: 0 },
        { id: '2', url: 'u', pageUrl: 'u', title: '', exact: 'not on page', prefix: '', suffix: '', note: '', createdAt: 0 },
      ]);
      expect(n).toBe(1);
      expect(set).toHaveBeenCalledWith('ai-reader-highlight', expect.objectContaining({ ranges: [expect.any(Object)] }));
      expect(document.getElementById('ai-reader-highlight-style')).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
