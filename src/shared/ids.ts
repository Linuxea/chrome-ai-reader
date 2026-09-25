/**
 * Id generation shared by every context (side panel, service worker, content
 * script). Pure — no DOM, no chrome.*.
 */

import type { ChatMessage } from './types';

/** RFC 4122 v4 UUID; falls back to Math.random where crypto.randomUUID is missing. */
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Give every message without an id one, in place. Messages persisted before
 * ids existed get theirs on restore, so retry / edit can always address a
 * history entry by id instead of by content.
 */
export function ensureMessageIds(messages: ChatMessage[]): ChatMessage[] {
  for (const m of messages) if (!m.id) m.id = genId();
  return messages;
}
