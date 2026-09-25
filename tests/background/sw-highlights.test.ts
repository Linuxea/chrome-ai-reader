import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { dbClear } from '../../src/shared/db';
import {
  addHighlight, listHighlights, updateHighlightNote, deleteHighlight, allHighlights,
  getCachedAnnotations, saveCachedAnnotations, MAX_ANNOTATION_CACHE,
} from '../../src/background/sw-highlights';

beforeEach(async () => {
  await dbClear('highlights');
  await dbClear('annotations');
});

describe('background/sw-highlights', () => {
  it('stores highlights per normalized URL; update and delete by id', async () => {
    const h = await addHighlight({ exact: 'x', prefix: 'a', suffix: 'b', pageUrl: 'https://Site.example/p?utm_source=z#frag', title: 'T' });
    await addHighlight({ exact: 'y', prefix: '', suffix: '', pageUrl: 'https://other.example/' });
    const list = await listHighlights('https://site.example/p');
    expect(list.map((i) => i.exact)).toEqual(['x']);
    await updateHighlightNote(h.id, 'a note');
    expect((await listHighlights('https://site.example/p'))[0].note).toBe('a note');
    await deleteHighlight(h.id);
    expect(await listHighlights('https://site.example/p')).toEqual([]);
    expect((await allHighlights()).map((i) => i.exact)).toEqual(['y']);
  });

  it('caches annotation runs and evicts the oldest beyond the limit', async () => {
    for (let i = 0; i < MAX_ANNOTATION_CACHE + 1; i++) {
      await saveCachedAnnotations({ key: `k${i}`, results: [], createdAt: i });
    }
    expect(await getCachedAnnotations('k0')).toBeUndefined();
    expect((await getCachedAnnotations(`k${MAX_ANNOTATION_CACHE}`))?.key).toBe(`k${MAX_ANNOTATION_CACHE}`);
  });
});
