/**
 * Platform layer — one-shot `chrome.runtime` messaging wrappers.
 *
 * Covers `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` and
 * `chrome.tabs.sendMessage`. Port-based streaming lives in `./ports.ts`.
 *
 * These wrappers keep the magic `return true` for async sendResponse and give
 * tests a single seam to mock instead of the global `chrome.runtime`.
 */

/** Send a one-shot message to the background/runtime. */
export function sendMessage(message: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/** Send a one-shot message to a specific tab's content script. */
export function sendTabMessage(tabId: number, message: unknown): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * Register a one-shot message listener.
 *
 * The handler returns `true` to signal async sendResponse, `undefined`/`false`
 * otherwise (matching the chrome.runtime.onMessage contract).
 * Returns an unsubscribe function.
 */
export function onMessage(
  handler: (
    msg: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean | undefined | void,
): () => void {
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

/** Open the extension's options page. */
export function openOptionsPage(): Promise<void> {
  return chrome.runtime.openOptionsPage();
}
