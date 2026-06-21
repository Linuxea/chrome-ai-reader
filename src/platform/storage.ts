/**
 * Platform layer — `chrome.storage` access wrappers.
 *
 * Centralizes all reads/writes/subscription to `chrome.storage.{sync,session,local}`
 * so that:
 *   1. Business modules depend on this abstraction, not on `chrome.*` globals.
 *   2. `chrome.storage.onChanged` subscriptions can be expressed as
 *      `onSyncChange('key', cb)` — removing the boilerplate that was duplicated
 *      across tts/index, quick-commands, and suggest-questions.
 *   3. Tests have a single seam to mock.
 */

/** Read values from chrome.storage.sync (promise). */
export async function getSync<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return (await chrome.storage.sync.get(keys)) as T;
}

/** Read values from chrome.storage.session (promise). */
export async function getSession<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return (await chrome.storage.session.get(keys)) as T;
}

/** Read values from chrome.storage.local (promise). */
export async function getLocal<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return (await chrome.storage.local.get(keys)) as T;
}

/** Write to chrome.storage.sync. */
export function setSync(items: Record<string, unknown>): Promise<void> {
  return chrome.storage.sync.set(items);
}

/** Write to chrome.storage.session. */
export function setSession(items: Record<string, unknown>): Promise<void> {
  return chrome.storage.session.set(items);
}

/** Write to chrome.storage.local. */
export function setLocal(items: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(items);
}

/** Remove keys from chrome.storage.session. */
export function removeSession(keys: string | string[]): Promise<void> {
  return chrome.storage.session.remove(keys);
}

/**
 * Subscribe to changes of a single key in the sync area.
 * Returns an unsubscribe function.
 *
 * Replaces the pattern:
 *   chrome.storage.onChanged.addListener((changes, area) => {
 *     if (area === 'sync' && changes.someKey) { ... }
 *   });
 */
export function onSyncChange(key: string, cb: (newValue: unknown) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area === 'sync' && key in changes) {
      cb(changes[key].newValue);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Generic storage.onChanged listener registration. Returns unsubscribe. */
export function onStorageChanged(
  cb: (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void,
): () => void {
  chrome.storage.onChanged.addListener(cb);
  return () => chrome.storage.onChanged.removeListener(cb);
}
