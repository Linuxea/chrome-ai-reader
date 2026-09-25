/**
 * Worker side of F6: highlights/notes and the deep-annotation cache live in
 * the extension's IndexedDB, which content scripts cannot open themselves.
 */

import { dbPut, dbGet, dbGetAll, dbGetAllByIndex, dbDelete } from '../shared/db';
import { normalizeUrl } from '../shared/url-normalize';
import { genId } from '../shared/ids';
import type { AnnotationCacheEntry, Highlight, TextQuoteSelector } from '../shared/highlights';

/** Annotation cache entries kept (oldest evicted). */
export const MAX_ANNOTATION_CACHE = 100;

export async function addHighlight(req: TextQuoteSelector & { pageUrl: string; title?: string; note?: string }): Promise<Highlight> {
  const h: Highlight = {
    id: genId(),
    url: normalizeUrl(req.pageUrl),
    pageUrl: req.pageUrl,
    title: req.title ?? '',
    exact: req.exact,
    prefix: req.prefix ?? '',
    suffix: req.suffix ?? '',
    note: req.note ?? '',
    createdAt: Date.now(),
  };
  await dbPut('highlights', h);
  return h;
}

export function listHighlights(pageUrl: string): Promise<Highlight[]> {
  return dbGetAllByIndex<Highlight>('highlights', 'url', normalizeUrl(pageUrl));
}

export async function updateHighlightNote(id: string, note: string): Promise<void> {
  const h = await dbGet<Highlight>('highlights', id);
  if (h) await dbPut('highlights', { ...h, note });
}

export const deleteHighlight = (id: string): Promise<void> => dbDelete('highlights', id);
export const allHighlights = (): Promise<Highlight[]> => dbGetAll<Highlight>('highlights');

export function getCachedAnnotations(key: string): Promise<AnnotationCacheEntry | undefined> {
  return dbGet<AnnotationCacheEntry>('annotations', key);
}

export async function saveCachedAnnotations(entry: AnnotationCacheEntry): Promise<void> {
  await dbPut('annotations', entry);
  const all = await dbGetAll<AnnotationCacheEntry>('annotations');
  if (all.length > MAX_ANNOTATION_CACHE) {
    all.sort((a, b) => a.createdAt - b.createdAt);
    for (const old of all.slice(0, all.length - MAX_ANNOTATION_CACHE)) await dbDelete('annotations', old.key);
  }
}

type Respond = (response?: unknown) => void;

/** Async handler wrapper: result → {success:true, …}, error → {success:false, error}. */
export function respond<T>(work: Promise<T>, sendResponse: Respond, field?: string): true {
  work
    .then((value) => sendResponse(field ? { success: true, [field]: value } : { success: true }))
    .catch((e: Error) => sendResponse({ success: false, error: e.message }));
  return true;
}
