/**
 * Tests for platform/settings.ts — area routing (secrets → local), defaults,
 * migration of legacy secrets out of sync, and change subscription.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const store: Record<'sync' | 'local', Record<string, unknown>> = { sync: {}, local: {} };
const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();

function area(name: 'sync' | 'local') {
  return {
    get: vi.fn(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (store[name][k] !== undefined) out[k] = store[name][k];
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store[name], items);
      const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
      listeners.forEach((l) => l(changes, name));
    }),
    remove: vi.fn(async (keys: string[] | string) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[name][k];
    }),
  };
}

vi.stubGlobal('chrome', {
  storage: {
    sync: area('sync'),
    local: area('local'),
    onChanged: { addListener: (l: never) => listeners.add(l), removeListener: (l: never) => listeners.delete(l) },
  },
});

import {
  readSettings, readStoredSettings, writeSettings, removeSettings, migrateSecretsToLocal, onSettingsChange, DEFAULT_API_BASE,
} from '../../src/platform/settings';

beforeEach(() => {
  store.sync = {};
  store.local = {};
  listeners.clear();
});

describe('platform/settings', () => {
  it('writes secrets to local (and clears them from sync), other settings to sync', async () => {
    store.sync.apiKey = 'old';
    await writeSettings({ apiKey: 'sk-new', modelName: 'm', ttsAccessKey: 'tts' });
    expect(store.local).toEqual({ apiKey: 'sk-new', ttsAccessKey: 'tts' });
    expect(store.sync).toEqual({ modelName: 'm' });
  });

  it('reads secrets from local, falling back to sync for not-yet-migrated values', async () => {
    store.local.apiKey = 'sk-local';
    store.sync.embeddingApiKey = 'emb-legacy';
    const s = await readSettings(['apiKey', 'embeddingApiKey']);
    expect(s).toEqual({ apiKey: 'sk-local', embeddingApiKey: 'emb-legacy' });
  });

  it('applies defaults on read, but readStoredSettings shows only what is stored', async () => {
    store.sync.apiBase = '';
    expect((await readSettings(['apiBase', 'suggestQuestions'])).apiBase).toBe(DEFAULT_API_BASE);
    expect(await readSettings(['suggestQuestions'])).toEqual({ suggestQuestions: true });
    expect(await readStoredSettings(['apiBase', 'modelName'])).toEqual({ apiBase: '' });
  });

  it('migrateSecretsToLocal moves legacy secrets and never overwrites a newer local value', async () => {
    store.sync = { apiKey: 'sync-key', ttsAccessKey: 'sync-tts', modelName: 'm' };
    store.local = { ttsAccessKey: 'local-tts' };
    await migrateSecretsToLocal();
    expect(store.local).toEqual({ apiKey: 'sync-key', ttsAccessKey: 'local-tts' });
    expect(store.sync).toEqual({ modelName: 'm' });
    await migrateSecretsToLocal(); // idempotent
    expect(store.local.apiKey).toBe('sync-key');
  });

  it('removeSettings clears keys from both areas', async () => {
    store.sync = { apiKey: 'a', modelName: 'm' };
    store.local = { apiKey: 'b' };
    await removeSettings(['apiKey', 'modelName']);
    expect(store.sync).toEqual({});
    expect(store.local).toEqual({});
  });

  it('onSettingsChange reports changes from each key\'s home area only', async () => {
    const cb = vi.fn();
    const off = onSettingsChange(['apiKey', 'modelName'], cb);
    await writeSettings({ apiKey: 'k' });
    expect(cb).toHaveBeenLastCalledWith({ apiKey: 'k' });
    await chrome.storage.sync.set({ apiKey: 'stale' }); // not apiKey's home
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    await writeSettings({ modelName: 'x' });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
