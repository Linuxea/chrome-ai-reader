/**
 * Safely disconnect a Chrome port, ignoring AlreadyClosed errors.
 * Used by TTS player, podcast audio, and downloader modules.
 */
export function safePortDisconnect(port: chrome.runtime.Port | null): void {
  if (!port) return;
  try { port.disconnect(); } catch { /* port may already be disconnected */ }
}

/**
 * Safely end a MediaSource stream if it's in the 'open' state.
 * Used by TTS player and podcast audio modules.
 */
export function safeEndOfStream(ms: MediaSource | null): void {
  if (!ms || ms.readyState !== 'open') return;
  try { ms.endOfStream(); } catch { /* network error or invalid state */ }
}
