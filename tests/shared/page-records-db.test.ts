/**
 * Tests for shared/page-records-db.ts — the IndexedDB storage contract.
 *
 * jsdom has no IndexedDB; fake-indexeddb provides a spec-complete one.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const { storageLocal } = vi.hoisted(() => {
  const storageLocal = { data: {} as Record<string, unknown> };
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys) => Promise.resolve(
          (Array.isArray(keys) ? keys : [keys]).reduce((acc: Record<string, unknown>, k: string) => {
            if (storageLocal.data[k] !== undefined) acc[k] = storageLocal.data[k];
            return acc;
          }, {})
        )),
        remove: vi.fn((keys) => {
          for (const k of (Array.isArray(keys) ? keys : [keys])) delete storageLocal.data[k];
          return Promise.resolve();
        }),
      },
    },
  } as unknown as typeof chrome;
  return { storageLocal };
});

import {
  putPageRecord, getPageRecord, getAllPageRecords, deletePageRecord,
  clearPageRecords, migrateLegacyPageRecords, LEGACY_PAGE_RECORDS_KEY,
} from '../../src/shared/page-records-db';
import { dbClear } from '../../src/shared/db';

const rec = (url: string, over = {}) => ({
  id: `id-${url}`, url, normalizedUrl: url, title: `T:${url}`, excerpt: 'x',
  embedding: [1, 0], timestamp: 1, ...over,
});

describe('shared/page-records-db', () => {
  beforeEach(async () => {
    await dbClear('pageRecords');
    for (const k of Object.keys(storageLocal.data)) delete storageLocal.data[k];
    vi.clearAllMocks();
  });

  it('put + get round-trips a record by normalizedUrl', async () => {
    await putPageRecord(rec('https://a.com'));
    expect(await getPageRecord('https://a.com')).toEqual(rec('https://a.com'));
    expect(await getPageRecord('https://missing.com')).toBeUndefined();
  });

  it('getAllPageRecords returns every stored record', async () => {
    await putPageRecord(rec('https://a.com'));
    await putPageRecord(rec('https://b.com'));
    const all = await getAllPageRecords();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.normalizedUrl).sort()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('deletePageRecord removes a single record', async () => {
    await putPageRecord(rec('https://a.com'));
    await deletePageRecord('https://a.com');
    expect(await getAllPageRecords()).toEqual([]);
  });

  it('clearPageRecords empties the store AND removes the legacy key', async () => {
    await putPageRecord(rec('https://a.com'));
    storageLocal.data[LEGACY_PAGE_RECORDS_KEY] = [rec('https://legacy.com')];

    await clearPageRecords();

    expect(await getAllPageRecords()).toEqual([]);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(LEGACY_PAGE_RECORDS_KEY);
    expect(storageLocal.data[LEGACY_PAGE_RECORDS_KEY]).toBeUndefined();
  });

  it('migrateLegacyPageRecords moves valid records into IDB and drops the legacy key', async () => {
    storageLocal.data[LEGACY_PAGE_RECORDS_KEY] = [
      rec('https://a.com'),
      rec('https://b.com'),
      { url: 'https://old.com', id: 'x' }, // no normalizedUrl — dropped
    ];

    await migrateLegacyPageRecords();

    const all = await getAllPageRecords();
    expect(all.map((r) => r.normalizedUrl).sort()).toEqual(['https://a.com', 'https://b.com']);
    expect(storageLocal.data[LEGACY_PAGE_RECORDS_KEY]).toBeUndefined();
  });

  it('migrateLegacyPageRecords is a no-op without the legacy key', async () => {
    await migrateLegacyPageRecords();
    expect(await getAllPageRecords()).toEqual([]);
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });
});
