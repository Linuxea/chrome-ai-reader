import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: { CITATION_CLICK: 'citationClick' },
}));

import { linkifyCitations, bindCitationClicks } from '../../../src/side_panel/ui/citations';
import { emit } from '../../../src/side_panel/events.js';

describe('ui/citations', () => {
  it('turns [#N] in text into chips, leaving code, pre and links alone', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Claim one [#3][#12]. Plain.</p><pre>[#1]</pre><p><code>[#2]</code> <a href="https://x">[#4]</a></p>';
    linkifyCitations(root);
    const chips = [...root.querySelectorAll<HTMLElement>('.cite-chip')];
    expect(chips.map((c) => c.dataset.cite)).toEqual(['3', '12']);
    expect(root.querySelector('p')!.textContent).toBe('Claim one 312. Plain.');
    expect(root.querySelector('pre')!.textContent).toBe('[#1]');
    expect(root.querySelector('code')!.textContent).toBe('[#2]');
    expect(root.querySelector('a')!.textContent).toBe('[#4]');
  });

  it('is idempotent (re-running does not nest chips)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>x [#5]</p>';
    linkifyCitations(root);
    linkifyCitations(root);
    expect(root.querySelectorAll('.cite-chip')).toHaveLength(1);
  });

  it('a chip click emits CITATION_CLICK with the paragraph index', () => {
    const area = document.createElement('div');
    area.innerHTML = '<p>see [#7]</p>';
    linkifyCitations(area);
    bindCitationClicks(area);
    area.querySelector<HTMLElement>('.cite-chip')!.click();
    expect(emit).toHaveBeenCalledWith('citationClick', { index: 7 });
  });
});
