/**
 * IndexedDB-backed storage for related-pages PageRecords.
 *
 * Replaces chrome.storage.local['pageRecords']: the old whole-array JSON blob
 * was bound by the 10MB storage.local quota, inflated float embeddings ~3-4x
 * as JSON text, and had to be read/rewritten in full for every upsert.
 * IndexedDB is keyed by normalizedUrl (single-record reads/writes), stores
 * numbers natively via structured clone, and is shared by every extension
 * context on the chrome-extension:// origin — side panel, options page, and
 * service worker all open the same database.
 *
 * All record *writes* go through the service worker (sw-related-pages.ts) so
 * upsert + FIFO eviction stay race-free in one context. The options page
 * calls clearPageRecords() directly (a whole-store clear needs no
 * coordination).
 */

import type { PageRecord } from './types';

const DB_NAME = 'ai-reader';
const DB_VERSION = 1;
const STORE_NAME = 'pageRecords';

/**
 * Legacy chrome.storage.local key, kept only for the one-shot migration
 * (migrateLegacyPageRecords) and for clearPageRecords() to sweep.
 */
export const LEGACY_PAGE_RECORDS_KEY = 'pageRecords';

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'normalizedUrl' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // If the connection dies (e.g. blocked upgrade), allow the next call to retry.
    _dbPromise.catch(() => { _dbPromise = null; });
  }
  return _dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return requestToPromise(op(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
}

export function putPageRecord(record: PageRecord): Promise<void> {
  return withStore('readwrite', (s) => s.put(record)).then(() => undefined);
}

export async function getPageRecord(normalizedUrl: string): Promise<PageRecord | undefined> {
  return await withStore('readonly', (s) => s.get(normalizedUrl)) as PageRecord | undefined;
}

export async function getAllPageRecords(): Promise<PageRecord[]> {
  return await withStore('readonly', (s) => s.getAll()) as PageRecord[];
}

export function deletePageRecord(normalizedUrl: string): Promise<void> {
  return withStore('readwrite', (s) => s.delete(normalizedUrl)).then(() => undefined);
}

function clearPageRecordStore(): Promise<void> {
  return withStore('readwrite', (s) => s.clear()).then(() => undefined);
}

/**
 * Clear all page records — both the IndexedDB store and any unmigrated
 * legacy chrome.storage.local blob. Called from the options page
 * (embedding-settings.ts) and the side panel's clearAllPageRecords().
 */
export async function clearPageRecords(): Promise<void> {
  await clearPageRecordStore();
  await chrome.storage.local.remove(LEGACY_PAGE_RECORDS_KEY);
}

/**
 * One-shot migration: move records written by the pre-IndexedDB build from
 * chrome.storage.local into the store, then remove the legacy key. Records
 * lacking normalizedUrl predate URL normalization and are dropped (they were
 * mostly embedded against misconfigured providers — re-indexing is
 * preferable). No-op once the legacy key is gone.
 */
export async function migrateLegacyPageRecords(): Promise<void> {
  const data = await chrome.storage.local.get(LEGACY_PAGE_RECORDS_KEY);
  const legacy = data[LEGACY_PAGE_RECORDS_KEY] as PageRecord[] | undefined;
  if (!Array.isArray(legacy)) return;
  for (const record of legacy) {
    if (record && typeof record.normalizedUrl === 'string') await putPageRecord(record);
  }
  await chrome.storage.local.remove(LEGACY_PAGE_RECORDS_KEY);
}
