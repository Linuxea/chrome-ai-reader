import { getActiveTab } from '../../platform/tabs';

/**
 * Capture the currently visible area of the active tab as a PNG data URL.
 *
 * Called from the side panel — `chrome.tabs.captureVisibleTab` is available
 * to extension pages with the `activeTab` permission (already granted). No
 * `debugger` permission needed; no background relay needed.
 *
 * @returns PNG data URI (`data:image/png;base64,...`)
 * @throws if there is no active tab/window or capture is denied (e.g. on
 *         `chrome://` internal pages).
 */
export async function captureVisibleTab(): Promise<string> {
  const tab = await getActiveTab();
  if (tab.windowId === undefined) throw new Error('No active tab window');
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
}
