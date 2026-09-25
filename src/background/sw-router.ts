/**
 * Service-worker routing: one registry per channel kind instead of an
 * if/else chain, plus a sender check on everything that arrives.
 *
 * Each route declares who may use it:
 *   - 'extension' — extension pages only (side panel, options);
 *   - 'content'   — our content scripts (and extension pages).
 * Anything from another extension, or a content-script message for an
 * extension-only route (a compromised page context calling `fetchModels`
 * with an attacker-chosen apiBase, say), is dropped.
 */

import type { PortName } from '../shared/protocol';

export type SenderKind = 'extension' | 'content' | 'foreign';
export type Audience = 'extension' | 'content';

export function senderKind(sender: chrome.runtime.MessageSender | undefined): SenderKind {
  if (!sender || sender.id !== chrome.runtime.id) return 'foreign';
  const url = sender.url ?? sender.origin ?? '';
  return url.startsWith(`chrome-extension://${chrome.runtime.id}/`) ? 'extension' : 'content';
}

function allowed(audience: Audience, kind: SenderKind): boolean {
  if (kind === 'foreign') return false;
  return audience === 'content' || kind === 'extension';
}

type PortHandler = (msg: Record<string, unknown>, port: chrome.runtime.Port) => Promise<void> | void;
type MessageHandler = (
  msg: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

const portRoutes = new Map<string, { audience: Audience; handle: PortHandler }>();
const messageRoutes = new Map<string, { audience: Audience; handle: MessageHandler }>();

/** Register a long-lived Port channel. `handle` runs for every message on the port. */
export function registerPort(name: PortName, audience: Audience, handle: PortHandler): void {
  portRoutes.set(name, { audience, handle });
}

/**
 * Register a one-shot `action`. Return `true` from `handle` to keep the
 * response channel open for an async sendResponse.
 */
export function registerMessage(action: string, audience: Audience, handle: MessageHandler): void {
  messageRoutes.set(action, { audience, handle });
}

export function dispatchConnect(port: chrome.runtime.Port): void {
  const route = portRoutes.get(port.name);
  if (!route) return;
  if (!allowed(route.audience, senderKind(port.sender))) {
    try { port.disconnect(); } catch { /* already gone */ }
    return;
  }
  port.onMessage.addListener(async (msg: Record<string, unknown>) => {
    try {
      await route.handle(msg, port);
    } catch (e) {
      console.error(`[sw] ${port.name} handler failed:`, e);
    }
  });
}

export function dispatchMessage(
  msg: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean | void {
  const action = typeof msg?.action === 'string' ? msg.action : '';
  const route = messageRoutes.get(action);
  if (!route || !allowed(route.audience, senderKind(sender))) return;
  return route.handle(msg, sender, sendResponse);
}

/** Test accessor: forget all routes. */
export function __resetRoutes(): void {
  portRoutes.clear();
  messageRoutes.clear();
}
