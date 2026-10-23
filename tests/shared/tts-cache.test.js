/**
 * Tests for shared/tts-cache.ts — the per-segment TTS audio cache.
 *
 * shared/db.js is replaced by an in-memory Map with a cursor-capable fake
 * `openDB()` so the LRU pruning path runs without real IndexedDB (jsdom has
 * none).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/shared/db.js', () => {
  const state = { store: new Map() };
  const mockDb = {
    transaction() {
      const sorted = () => [...state.store.entries()]
        .filter(([k]) => k !== '__meta__')
        .sort((a, b) => (a[1].lastUsedAt || 0) - (b[1].lastUsedAt || 0));
      return {
        objectStore() {
          return {
            index() {
              return {
                openCursor() {
                  const list = sorted();
                  let i = 0;
                  const req = { onsuccess: null, onerror: null, result: null };
                  const advance = () => {
                    if (i < list.length) {
                      const [key, value] = list[i];
                      req.result = {
                        value,
                        delete: () => { state.store.delete(key); },
                        continue: () => { i += 1; advance(); },
                      };
                    } else {
                      req.result = null;
                    }
                    req.onsuccess?.();
                  };
                  setTimeout(advance, 0); // after the caller registers onsuccess
                  return req;
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    dbPut: vi.fn(async (_store, value) => { state.store.set(value.key, value); }),
    dbGet: vi.fn(async (_store, key) => state.store.get(key)),
    dbDelete: vi.fn(async (_store, key) => { state.store.delete(key); }),
    dbClear: vi.fn(async (_store) => { state.store.clear(); }),
    openDB: vi.fn(async () => mockDb),
    __state: state,
  };
});

import {
  ttsCacheKey, getCachedSegmentAudio, putSegmentAudio,
  estimateTtsCacheBytes, clearTtsCache, __setTtsCacheCapForTesting,
} from '../../src/shared/tts-cache.js';
import * as dbMock from '../../src/shared/db.js';

const state = dbMock.__state;
const blobOf = (s) => new Blob([s], { type: 'audio/mpeg' });

describe('ttsCacheKey', () => {
  it('is stable for identical voice + text', async () => {
    const a = await ttsCacheKey({ speaker: 'spk', resourceId: 'res' }, 'same text');
    const b = await ttsCacheKey({ speaker: 'spk', resourceId: 'res' }, 'same text');
    expect(a).toBe(b);
    expect(a).not.toContain('same text'); // hashed, not raw
  });

  it('differs per speaker, resource and text', async () => {
    const base = await ttsCacheKey({ speaker: 'a', resourceId: 'r' }, 't');
    expect(await ttsCacheKey({ speaker: 'b', resourceId: 'r' }, 't')).not.toBe(base);
    expect(await ttsCacheKey({ speaker: 'a', resourceId: 'r2' }, 't')).not.toBe(base);
    expect(await ttsCacheKey({ speaker: 'a', resourceId: 'r' }, 't2')).not.toBe(base);
  });
});

describe('segment round-trip', () => {
  beforeEach(() => { state.store.clear(); });

  it('miss → null; put → hit with the same bytes', async () => {
    expect(await getCachedSegmentAudio('k1')).toBeNull();
    await putSegmentAudio('k1', blobOf('audio-bytes'));
    const hit = await getCachedSegmentAudio('k1');
    expect(hit).toBeInstanceOf(Blob);
    expect(await hit.text()).toBe('audio-bytes');
  });

  it('touch updates lastUsedAt (LRU order)', async () => {
    await putSegmentAudio('k1', blobOf('x'));
    const before = state.store.get('k1').lastUsedAt;
    await new Promise(r => setTimeout(r, 5));
    await getCachedSegmentAudio('k1');
    await vi.waitFor(() => {
      expect(state.store.get('k1').lastUsedAt).toBeGreaterThan(before);
    });
  });

  it('drops corrupt records (no blob) and reports a miss', async () => {
    state.store.set('bad', { key: 'bad', bytes: 5, lastUsedAt: 1 }); // no blob
    expect(await getCachedSegmentAudio('bad')).toBeNull();
    await vi.waitFor(() => expect(state.store.has('bad')).toBe(false));
  });
});

describe('byte accounting + eviction', () => {
  beforeEach(() => { state.store.clear(); });
  afterEach(() => { __setTtsCacheCapForTesting(150 * 1024 * 1024); });

  it('estimateTtsCacheBytes tracks puts and survives re-put of the same key', async () => {
    expect(await estimateTtsCacheBytes()).toBe(0);
    await putSegmentAudio('k', blobOf('12345')); // 5 bytes
    expect(await estimateTtsCacheBytes()).toBe(5);
    await putSegmentAudio('k', blobOf('1234567')); // 7 bytes — delta accounting
    expect(await estimateTtsCacheBytes()).toBe(7);
  });

  it('LRU-prunes oldest segments once over the cap', async () => {
    __setTtsCacheCapForTesting(100);
    await putSegmentAudio('old', blobOf('x'.repeat(60)));
    await new Promise(r => setTimeout(r, 5));
    await putSegmentAudio('new', blobOf('y'.repeat(60)));

    // over cap (120 > 100): the least recently used ('old') is evicted
    expect(state.store.has('old')).toBe(false);
    expect(state.store.has('new')).toBe(true);
    expect(await estimateTtsCacheBytes()).toBe(60);
    expect(await (await getCachedSegmentAudio('new')).text()).toBe('y'.repeat(60));
  });

  it('clearTtsCache wipes records and resets the accounting', async () => {
    await putSegmentAudio('k', blobOf('xyz'));
    expect(await estimateTtsCacheBytes()).toBeGreaterThan(0);
    await clearTtsCache();
    expect(await estimateTtsCacheBytes()).toBe(0);
    expect(await getCachedSegmentAudio('k')).toBeNull();
  });
});
