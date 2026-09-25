import { vi, describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { dbClear } from '../../src/shared/db';
import {
  listChats, getChat, putChat, deleteChatRecord, migrateLegacyChats, __resetChatsMigration,
  LEGACY_CHATS_KEY, MAX_CHATS, type ChatHistoryEntry,
} from '../../src/shared/chats-db';

const local: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (k: string) => (local[k] !== undefined ? { [k]: local[k] } : {})),
      remove: vi.fn(async (k: string) => { delete local[k]; }),
    },
  },
});

const chat = (id: string, updatedAt: number): ChatHistoryEntry => ({
  id, title: id, messages: [], conversationHistory: [], createdAt: updatedAt, updatedAt,
});

beforeEach(async () => {
  __resetChatsMigration();
  await dbClear('chats');
  for (const k of Object.keys(local)) delete local[k];
});

describe('shared/chats-db', () => {
  it('migrates the legacy storage.local array once, then drops it', async () => {
    local[LEGACY_CHATS_KEY] = [chat('a', 1), chat('b', 2), { bogus: true }];
    await migrateLegacyChats();
    expect((await listChats()).map((c) => c.id)).toEqual(['b', 'a']);
    expect(local[LEGACY_CHATS_KEY]).toBeUndefined();
  });

  it('put / get / delete one chat without touching the others', async () => {
    await putChat(chat('a', 1));
    await putChat(chat('b', 2));
    await putChat({ ...chat('a', 3), title: 'renamed' });
    expect((await getChat('a'))?.title).toBe('renamed');
    await deleteChatRecord('b');
    expect((await listChats()).map((c) => c.id)).toEqual(['a']);
  });

  it(`keeps at most MAX_CHATS, evicting the least recently updated`, async () => {
    for (let i = 0; i < MAX_CHATS + 2; i++) await putChat(chat(`c${i}`, i));
    const ids = (await listChats()).map((c) => c.id);
    expect(ids).toHaveLength(MAX_CHATS);
    expect(ids).not.toContain('c0');
    expect(ids).not.toContain('c1');
  });
});
