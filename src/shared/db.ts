/**
 * The extension's IndexedDB database (`ai-reader`), shared by every
 * extension context on the chrome-extension:// origin — side panel, options
 * page and service worker open the same database. (Content scripts cannot:
 * their indexedDB is the web page's. They go through the worker.)
 *
 * One module owns the schema so versions never diverge between contexts:
 *
 *   v1  pageRecords   keyPath normalizedUrl         related-reading embeddings
 *   v2  chats         keyPath id, index updatedAt   saved conversations
 *       highlights    keyPath id, index url         user highlights / notes
 *       annotations   keyPath key                   deep-annotation cache
 *       translations  keyPath key                   immersive-translation cache
 */

export const DB_NAME = 'ai-reader';
export const DB_VERSION = 2;

export type StoreName = 'pageRecords' | 'chats' | 'highlights' | 'annotations' | 'translations';

let _dbPromise: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('pageRecords')) db.createObjectStore('pageRecords', { keyPath: 'normalizedUrl' });
  if (!db.objectStoreNames.contains('chats')) {
    db.createObjectStore('chats', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains('highlights')) {
    db.createObjectStore('highlights', { keyPath: 'id' }).createIndex('url', 'url');
  }
  if (!db.objectStoreNames.contains('annotations')) db.createObjectStore('annotations', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('translations')) db.createObjectStore('translations', { keyPath: 'key' });
}

export function openDB(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => {
        const db = req.result;
        // Another context is upgrading: step aside so it isn't blocked; the
        // next call reopens at the new version.
        db.onversionchange = () => { db.close(); _dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    _dbPromise.catch(() => { _dbPromise = null; });
  }
  return _dbPromise;
}

export function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function withStore<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return requestToPromise(op(db.transaction(store, mode).objectStore(store)));
}

export const dbPut = <T>(store: StoreName, value: T): Promise<void> =>
  withStore(store, 'readwrite', (s) => s.put(value)).then(() => undefined);

export const dbGet = <T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> =>
  withStore(store, 'readonly', (s) => s.get(key)) as Promise<T | undefined>;

export const dbGetAll = <T>(store: StoreName): Promise<T[]> =>
  withStore(store, 'readonly', (s) => s.getAll()) as Promise<T[]>;

export const dbGetAllByIndex = <T>(store: StoreName, index: string, key: IDBValidKey): Promise<T[]> =>
  withStore(store, 'readonly', (s) => s.index(index).getAll(key)) as Promise<T[]>;

export const dbDelete = (store: StoreName, key: IDBValidKey): Promise<void> =>
  withStore(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);

export const dbClear = (store: StoreName): Promise<void> =>
  withStore(store, 'readwrite', (s) => s.clear()).then(() => undefined);

/** Test accessor: drop the cached connection. */
export function __resetDB(): void {
  _dbPromise = null;
}
