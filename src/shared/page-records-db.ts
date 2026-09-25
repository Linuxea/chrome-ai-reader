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
import { dbPut, dbGet, dbGetAll, dbDelete, dbClear } from './db';

/**
 * Legacy chrome.storage.local key, kept only for the one-shot migration
 * (migrateLegacyPageRecords) and for clearPageRecords() to sweep.
 */
export const LEGACY_PAGE_RECORDS_KEY = 'pageRecords';

export const putPageRecord = (record: PageRecord): Promise<void> => dbPut('pageRecords', record);
export const getPageRecord = (normalizedUrl: string): Promise<PageRecord | undefined> => dbGet<PageRecord>('pageRecords', normalizedUrl);
export const getAllPageRecords = (): Promise<PageRecord[]> => dbGetAll<PageRecord>('pageRecords');
export const deletePageRecord = (normalizedUrl: string): Promise<void> => dbDelete('pageRecords', normalizedUrl);
const clearPageRecordStore = (): Promise<void> => dbClear('pageRecords');

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
