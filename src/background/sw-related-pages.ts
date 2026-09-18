/**
 * Service-worker side of the related-pages feature: owns all PageRecord
 * writes (upsert + FIFO eviction) and the cosine-similarity ranking, so the
 * side panel only sends one-shot messages instead of shuttling whole record
 * arrays through chrome.storage.local.
 *
 * Both handlers await the legacy-storage migration promise first, so a
 * find/store arriving while the migration is still running cannot observe a
 * half-migrated store.
 */

import type { PageRecord, PageRelation } from '../shared/types';
import {
  getPageRecord, putPageRecord, getAllPageRecords, deletePageRecord,
  migrateLegacyPageRecords,
} from '../shared/page-records-db';
import { findRelatedRecords } from '../shared/vector';

export interface StorePageRecordRequest {
  record: Omit<PageRecord, 'id' | 'timestamp'>;
  maxPages: number;
}

export interface FindRelatedRequest {
  normalizedUrl: string;
  threshold: number;
  limit: number;
}

const migrationPromise: Promise<void> = migrateLegacyPageRecords().catch((e: unknown) => {
  console.error('page-records migration failed:', e);
});

/** Upsert by normalizedUrl (preserving id), then evict oldest beyond maxPages. */
export async function storePageRecord(req: StorePageRecordRequest): Promise<void> {
  await migrationPromise;

  const existing = await getPageRecord(req.record.normalizedUrl);
  const record: PageRecord = {
    ...req.record,
    id: existing?.id ?? crypto.randomUUID(),
    timestamp: Date.now(),
  };
  await putPageRecord(record);

  const all = await getAllPageRecords();
  if (all.length > req.maxPages) {
    all.sort((a, b) => a.timestamp - b.timestamp);
    for (const old of all.slice(0, all.length - req.maxPages)) {
      await deletePageRecord(old.normalizedUrl);
    }
  }
}

/** Top-`limit` relations at or above `threshold`, ranked in the worker. */
export async function findRelated(req: FindRelatedRequest): Promise<PageRelation[]> {
  await migrationPromise;
  const all = await getAllPageRecords();
  return findRelatedRecords(all, req.normalizedUrl, req.threshold, req.limit);
}

/** chrome.runtime.onMessage handler for the pageRecords:* actions. */
export function handlePageRecordsMessage(
  msg: Record<string, unknown>,
  sendResponse: (response?: unknown) => void,
): boolean {
  if (msg.action === 'pageRecords:store') {
    storePageRecord(msg as unknown as StorePageRecordRequest)
      .then(() => sendResponse({ success: true }))
      .catch((e: Error) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (msg.action === 'pageRecords:findRelated') {
    findRelated(msg as unknown as FindRelatedRequest)
      .then((relations) => sendResponse({ success: true, relations }))
      .catch((e: Error) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  return false;
}
