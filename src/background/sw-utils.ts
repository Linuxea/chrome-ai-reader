export function safePostMessage(port: chrome.runtime.Port, msg: Record<string, unknown>): void {
  try { port.postMessage(msg); } catch { /* Port may have been disconnected */ }
}
