/**
 * Tests for background/sw-related-pages.ts — the worker-side owner of
 * PageRecord writes (upsert + FIFO eviction) and similarity ranking.
 *
 * shared/page-records-db is mocked with an in-memory Map so the handler
 * logic is tested without IndexedDB (jsdom has none); page-records-db has
 * its own fake-IDB test.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => {
  return { db: { records: new Map() } };
});

vi.mock('../../src/shared/page-records-db.js', () => ({
  getPageRecord: vi.fn((normalizedUrl) => Promise.resolve(db.records.get(normalizedUrl))),
  putPageRecord: vi.fn((record) => { db.records.set(record.normalizedUrl, record); return Promise.resolve(); }),
  getAllPageRecords: vi.fn(() => Promise.resolve([...db.records.values()])),
  deletePageRecord: vi.fn((normalizedUrl) => { db.records.delete(normalizedUrl); return Promise.resolve(); }),
  migrateLegacyPageRecords: vi.fn(() => Promise.resolve()),
}));

import { storePageRecord, findRelated, handlePageRecordsMessage } from '../../src/background/sw-related-pages.js';

const rec = (url, embedding, timestamp = 0) => ({
  url, normalizedUrl: url, title: `T:${url}`, excerpt: 'x', embedding,
});

describe('background/sw-related-pages', () => {
  beforeEach(() => {
    db.records.clear();
    vi.clearAllMocks();
  });

  describe('storePageRecord', () => {
    it('inserts a new record with generated id and timestamp', async () => {
      await storePageRecord({ record: rec('https://a.com', [1, 0]), maxPages: 10 });
      const stored = db.records.get('https://a.com');
      expect(stored).toBeDefined();
      expect(stored.id).toBeTruthy();
      expect(stored.timestamp).toBeGreaterThan(0);
    });

    it('upserts by normalizedUrl and preserves the existing id', async () => {
      await storePageRecord({ record: rec('https://a.com', [1, 0]), maxPages: 10 });
      const firstId = db.records.get('https://a.com').id;
      await storePageRecord({ record: { ...rec('https://a.com', [0, 1]), title: 'New' }, maxPages: 10 });
      expect(db.records.size).toBe(1);
      expect(db.records.get('https://a.com').id).toBe(firstId);
      expect(db.records.get('https://a.com').title).toBe('New');
    });

    it('evicts oldest records (FIFO) beyond maxPages', async () => {
      // Seed with distinct timestamps (storePageRecord uses Date.now(), so
      // seed directly).
      db.records.set('https://old.com', { ...rec('https://old.com', [1, 0]), id: 'old', timestamp: 1 });
      db.records.set('https://new.com', { ...rec('https://new.com', [1, 0]), id: 'new', timestamp: 2 });

      await storePageRecord({ record: rec('https://fresh.com', [1, 0]), maxPages: 2 });

      expect(db.records.has('https://old.com')).toBe(false);
      expect(db.records.has('https://new.com')).toBe(true);
      expect(db.records.has('https://fresh.com')).toBe(true);
    });
  });

  describe('findRelated', () => {
    it('returns ranked relations above threshold', async () => {
      db.records.set('https://current.com', { ...rec('https://current.com', [1, 0, 0]), id: '1', timestamp: 1 });
      db.records.set('https://related.com', { ...rec('https://related.com', [1, 0.1, 0]), id: '2', timestamp: 2 });
      db.records.set('https://unrelated.com', { ...rec('https://unrelated.com', [0, 1, 0]), id: '3', timestamp: 3 });

      const relations = await findRelated({ normalizedUrl: 'https://current.com', threshold: 0.7, limit: 5 });
      expect(relations).toHaveLength(1);
      expect(relations[0].record.url).toBe('https://related.com');
    });

    it('returns empty when the current page is not indexed', async () => {
      const relations = await findRelated({ normalizedUrl: 'https://missing.com', threshold: 0.7, limit: 5 });
      expect(relations).toEqual([]);
    });
  });

  describe('handlePageRecordsMessage', () => {
    it('handles pageRecords:store and responds success', async () => {
      const sendResponse = vi.fn();
      const ret = handlePageRecordsMessage(
        { action: 'pageRecords:store', record: rec('https://a.com', [1, 0]), maxPages: 10 },
        sendResponse,
      );
      expect(ret).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true }));
      expect(db.records.has('https://a.com')).toBe(true);
    });

    it('handles pageRecords:findRelated and responds with relations', async () => {
      db.records.set('https://current.com', { ...rec('https://current.com', [1, 0]), id: '1', timestamp: 1 });
      db.records.set('https://related.com', { ...rec('https://related.com', [1, 0.1]), id: '2', timestamp: 2 });

      const sendResponse = vi.fn();
      const ret = handlePageRecordsMessage(
        { action: 'pageRecords:findRelated', normalizedUrl: 'https://current.com', threshold: 0.5, limit: 5 },
        sendResponse,
      );
      expect(ret).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      });
      const relations = sendResponse.mock.calls[0][0].relations;
      expect(relations).toHaveLength(1);
      expect(relations[0].record.url).toBe('https://related.com');
    });

    it('responds with success:false when the store fails', async () => {
      const { getPageRecord } = await import('../../src/shared/page-records-db.js');
      getPageRecord.mockRejectedValueOnce(new Error('idb down'));

      const sendResponse = vi.fn();
      handlePageRecordsMessage(
        { action: 'pageRecords:store', record: rec('https://a.com', [1, 0]), maxPages: 10 },
        sendResponse,
      );
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'idb down' });
      });
    });

    it('returns false for unrelated actions', () => {
      expect(handlePageRecordsMessage({ action: 'fetchModels' }, vi.fn())).toBe(false);
    });
  });
});
