import { getActiveTab } from '../../platform/tabs';
import { sendTabMessage } from '../../platform/messaging';
import type { ScrollPageState } from '../../shared/protocol';

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

/** Chrome throttles `captureVisibleTab` to ~2 calls/sec — stay under it. */
const MIN_CAPTURE_INTERVAL_MS = 550;

/** Fuse against infinite-scroll pages: at most this many viewport segments. */
export const MAX_SEGMENTS = 15;

/** Result of a full-page run: captured segments plus an error if the run ended early. */
export interface FullPageCaptureResult {
  dataUris: string[];
  /** Set when the loop aborted mid-run (e.g. content script lost); partial captures kept. */
  error?: string;
}

/** Progress callback: `done` segments captured, `total` is a live estimate. */
export type FullPageProgress = (done: number, total: number) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asState(v: unknown, step: string): ScrollPageState {
  const s = v as Partial<ScrollPageState> | null | undefined;
  if (
    !s ||
    typeof s.y !== 'number' ||
    typeof s.innerHeight !== 'number' ||
    typeof s.scrollHeight !== 'number' ||
    typeof s.atBottom !== 'boolean'
  ) {
    throw new Error(`${step}: bad scroll state from content script`);
  }
  return s as ScrollPageState;
}

function estimateSegments(s: ScrollPageState): number {
  if (s.innerHeight <= 0) return 1;
  return Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(s.scrollHeight / s.innerHeight)));
}

/**
 * Capture the whole page top-to-bottom as one screenshot per viewport segment.
 *
 * Drives the content script (scrollBegin/scrollNext/scrollRestore) one
 * message at a time: capture → scroll one viewport → wait for lazy content →
 * repeat until the page reports `atBottom` or MAX_SEGMENTS is hit. The user's
 * original scroll position is restored in `finally`, even on failure.
 *
 * Never throws — all failures (no active tab, missing content script, lost
 * capture permission mid-run) are reported via `error` so the caller keeps a
 * single code path. Partial captures taken before a mid-run failure are kept.
 */
export async function captureFullPage(onProgress?: FullPageProgress): Promise<FullPageCaptureResult> {
  const tab = await getActiveTab();
  if (tab.id === undefined || tab.windowId === undefined) {
    return { dataUris: [], error: 'No active tab' };
  }
  const tabId = tab.id;

  let lastCaptureAt = 0;
  const capture = async (): Promise<string> => {
    const wait = MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
    if (wait > 0) await sleep(wait);
    const uri = await chrome.tabs.captureVisibleTab(tab.windowId as number, { format: 'png' });
    lastCaptureAt = Date.now();
    return uri;
  };

  const send = (action: string): Promise<unknown> => sendTabMessage(tabId, { action });

  const dataUris: string[] = [];
  let error: string | undefined;
  let total = 1;

  try {
    let state = asState(await send('scrollBegin'), 'scrollBegin');
    total = estimateSegments(state);
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      dataUris.push(await capture());
      onProgress?.(i + 1, total);
      // On the last allowed segment there is no point scrolling further.
      if (state.atBottom || i === MAX_SEGMENTS - 1) break;
      state = asState(await send('scrollNext'), 'scrollNext');
      total = Math.max(total, estimateSegments(state));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    await send('scrollRestore').catch(() => {});
  }

  return { dataUris, error };
}
