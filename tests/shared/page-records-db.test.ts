/**
 * Tests for shared/page-records-db.ts — the IndexedDB storage contract.
 *
 * jsdom has no IndexedDB, so a minimal async fake is stubbed onto
 * globalThis.indexedDB: just enough of open/transaction/objectStore to
 * exercise the module's CRUD, migration, and clear paths.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { idbData, storageLocal } = vi.hoisted(() => {
  const idbData = { stores: new Map() }; // storeName -> Map(key -> value)
  const storageLocal = { data: {} };

  function makeRequest(executor) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        req.result = executor();
        req.onsuccess?.();
      } catch (e) {
        req.error = e;
        req.onerror?.();
      }
    });
    return req;
  }

  const fakeIndexedDB = {
    open(_name, _version) {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      const db = {
        objectStoreNames: { contains: (n) => idbData.stores.has(n) },
        createObjectStore: (n) => { idbData.stores.set(n, new Map()); },
        transaction: (storeName) => ({
          objectStore: (n) => {
            const data = idbData.stores.get(n);
            return {
              put: (v) => makeRequest(() => { data.set(v.normalizedUrl, v); return v.normalizedUrl; }),
              get: (k) => makeRequest(() => data.get(k)),
              getAll: () => makeRequest(() => [...data.values()]),
              delete: (k) => makeRequest(() => { data.delete(k); return undefined; }),
              clear: () => makeRequest(() => { data.clear(); return undefined; }),
            };
          },
        }),
      };
      req.result = db;
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };

  globalThis.indexedDB = fakeIndexedDB;
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys) => Promise.resolve(
          (Array.isArray(keys) ? keys : [keys]).reduce((acc, k) => {
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
  };

  return { idbData, storageLocal };
});

import {
  putPageRecord, getPageRecord, getAllPageRecords, deletePageRecord,
  clearPageRecords, migrateLegacyPageRecords, LEGACY_PAGE_RECORDS_KEY,
} from '../../src/shared/page-records-db';

const rec = (url, over = {}) => ({
  id: `id-${url}`, url, normalizedUrl: url, title: `T:${url}`, excerpt: 'x',
  embedding: [1, 0], timestamp: 1, ...over,
});

const store = () => idbData.stores.get('pageRecords');

describe('shared/page-records-db', () => {
  beforeEach(() => {
    store()?.clear();
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
