/**
 * Shared storage contract for the "related pages" / page-records feature.
 *
 * Both the side panel feature (`features/related-pages.ts`) and the options
 * page (`options/embedding-settings.ts`) read/write the same chrome.storage.local
 * key. Centralizing the key name here lets the options page clear records
 * WITHOUT importing a side_panel feature module — removing a cross-entry-point
 * layering violation (options → side_panel/features).
 */

/** chrome.storage.local key under which PageRecord[] is persisted. */
export const PAGE_RECORDS_KEY = 'pageRecords';

/** Remove all stored page records from chrome.storage.local. */
export async function clearPageRecords(): Promise<void> {
  await chrome.storage.local.remove(PAGE_RECORDS_KEY);
}
