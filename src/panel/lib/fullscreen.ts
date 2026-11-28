/**
 * F17 fullscreen mode — "detach" the current conversation into a full
 * browser tab. The page is the SAME Vite bundle (src/panel/index.html)
 * with `?full=1&tab=<id>`: the fullscreen tab binds the CONVERSATION's tab
 * id (it is itself a tab, so the active-tab query would resolve to
 * itself), and both surfaces keep rendering the same TabState through
 * lib/sync.ts.
 */
import { getActiveTabId, persistForTab } from '@/panel/state';

const PANEL_PAGE_PATH = 'src/panel/index.html';

/** The fullscreen page URL for a conversation bound to `tabId`. */
export function fullscreenPageUrl(tabId: number): string {
  return `${chrome.runtime.getURL(PANEL_PAGE_PATH)}?full=1&tab=${tabId}`;
}

/**
 * If `url` is our fullscreen page, the id of the conversation tab it is
 * bound to; otherwise null. Used by the side panel to treat that tab as
 * "the conversation's other window" instead of a new (empty) tab.
 */
export function parseFullscreenUrl(url: string | undefined): number | null {
  if (!url || !url.startsWith(chrome.runtime.getURL(PANEL_PAGE_PATH))) return null;
  try {
    const params = new URL(url).searchParams;
    if (params.get('full') !== '1') return null;
    const tabId = Number(params.get('tab'));
    return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
  } catch {
    return null;
  }
}

/** Is the given tab the fullscreen chat page? (null when the tab is gone.) */
export async function fullscreenLinkedTabOf(tabId: number): Promise<number | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return parseFullscreenUrl(tab?.url);
}

/**
 * The side panel's detach action: flush the current conversation to
 * session storage (the fullscreen page reads it at boot), then open the
 * fullscreen tab. No copy is made — both windows live on the same state.
 */
export async function openFullscreenChat(): Promise<void> {
  const tabId = getActiveTabId();
  if (tabId == null) return;
  // Pending debounced field writes must land before the other page boots.
  persistForTab(tabId);
  await chrome.tabs.create({ url: fullscreenPageUrl(tabId), active: true });
}
