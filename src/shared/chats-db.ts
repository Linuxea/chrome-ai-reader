/**
 * Saved conversations in IndexedDB (store `chats`, see shared/db.ts).
 *
 * Replaces chrome.storage.local['chatHistories'] — one array holding every
 * chat, read and rewritten whole on each save and capped at 50 by the 10MB
 * quota. Each chat is now its own record; saves touch one record.
 */

import type { ChatMessage } from './types';
import { dbPut, dbGet, dbGetAll, dbDelete } from './db';

/** Legacy storage.local key, migrated once. */
export const LEGACY_CHATS_KEY = 'chatHistories';
/** Chats kept; the least recently updated are evicted beyond this. */
export const MAX_CHATS = 300;

export interface DisplayMessage {
  role: string;
  content: string;
  type?: string;
  /** User messages: the quoted page text (kept apart so titles show the question). */
  quote?: string;
  /**
   * 'md': assistant `content` is the Markdown source. Absent on legacy
   * records, whose assistant content is a rendered HTML snapshot (untrusted —
   * always sanitized before it is rendered).
   */
  format?: 'md';
}

export interface ChatHistoryEntry {
  id: string;
  title: string;
  pageTitle?: string;
  /** Page the conversation was about (search / knowledge base). */
  pageUrl?: string;
  messages: DisplayMessage[];
  conversationHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

let _migration: Promise<void> | null = null;

/** Move chats saved by older versions out of storage.local. Idempotent; runs once per context. */
export function migrateLegacyChats(): Promise<void> {
  if (!_migration) {
    _migration = (async () => {
      const data = await chrome.storage.local.get(LEGACY_CHATS_KEY);
      const legacy = data[LEGACY_CHATS_KEY] as ChatHistoryEntry[] | undefined;
      if (!Array.isArray(legacy)) return;
      for (const chat of legacy) if (chat && typeof chat.id === 'string') await dbPut('chats', chat);
      await chrome.storage.local.remove(LEGACY_CHATS_KEY);
    })();
    _migration.catch(() => { _migration = null; });
  }
  return _migration;
}

/** All chats, most recently updated first. */
export async function listChats(): Promise<ChatHistoryEntry[]> {
  await migrateLegacyChats();
  const all = await dbGetAll<ChatHistoryEntry>('chats');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string): Promise<ChatHistoryEntry | undefined> {
  await migrateLegacyChats();
  return dbGet<ChatHistoryEntry>('chats', id);
}

/** Save one chat, then evict the oldest beyond MAX_CHATS. */
export async function putChat(chat: ChatHistoryEntry): Promise<void> {
  await migrateLegacyChats();
  await dbPut('chats', chat);
  const all = await dbGetAll<ChatHistoryEntry>('chats');
  if (all.length > MAX_CHATS) {
    all.sort((a, b) => a.updatedAt - b.updatedAt);
    for (const old of all.slice(0, all.length - MAX_CHATS)) await dbDelete('chats', old.id);
  }
}

export async function deleteChatRecord(id: string): Promise<void> {
  await migrateLegacyChats();
  await dbDelete('chats', id);
}

/** Test accessor. */
export function __resetChatsMigration(): void {
  _migration = null;
}
