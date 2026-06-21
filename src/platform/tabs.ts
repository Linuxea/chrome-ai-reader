/**
 * Platform layer — `chrome.tabs` access wrappers.
 *
 * Centralizes tab queries and lifecycle listeners so business modules depend
 * on this abstraction rather than `chrome.tabs` directly.
 */

export interface ActiveTab {
  id: number | undefined;
  url: string | undefined;
  title: string | undefined;
}

/** Query the currently active tab in the current window. */
export async function getActiveTab(): Promise<ActiveTab> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  return { id: tab?.id, url: tab?.url, title: tab?.title };
}

/** Subscribe to tab activation changes. Returns unsubscribe. */
export function onTabActivated(cb: (tabId: number, windowId: number) => void): () => void {
  const listener = (activeInfo: chrome.tabs.OnActivatedInfo) => cb(activeInfo.tabId, activeInfo.windowId);
  chrome.tabs.onActivated.addListener(listener);
  return () => chrome.tabs.onActivated.removeListener(listener);
}

/** Subscribe to tab removal. Returns unsubscribe. */
export function onTabRemoved(cb: (tabId: number) => void): () => void {
  const listener = (tabId: number) => cb(tabId);
  chrome.tabs.onRemoved.addListener(listener);
  return () => chrome.tabs.onRemoved.removeListener(listener);
}
