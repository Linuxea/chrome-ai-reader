export function safePostMessage(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    // Port may have been disconnected by the client side
  }
}
