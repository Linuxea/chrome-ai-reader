/**
 * Tests for platform/storage.ts — chrome.storage access wrappers.
 *
 * Focuses on onSyncChange (the helper that replaced duplicated
 * chrome.storage.onChanged listeners in tts/index and suggest-questions):
 * - fires callback only for the watched key in the sync area
 * - returns an unsubscribe that stops further callbacks
 * - ignores changes in other storage areas (local/session)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Minimal chrome.storage mock with real listener fanout.
const onChangedListeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
const stores: Record<string, Record<string, unknown>> = { sync: {}, session: {}, local: {} };

function createStorageArea(area: string) {
  return {
    get(keys: string[] | string, cb?: (data: Record<string, unknown>) => void) {
      const result: Record<string, unknown> = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(k => {
        if (stores[area][k] !== undefined) result[k] = stores[area][k];
      });
      if (cb) cb(result);
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>, cb?: () => void) {
      Object.assign(stores[area], items);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys: string | string[], cb?: () => void) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(k => delete stores[area][k]);
      if (cb) cb();
      return Promise.resolve();
    },
  };
}

vi.stubGlobal('chrome', {
  storage: {
    sync: createStorageArea('sync'),
    session: createStorageArea('session'),
    local: createStorageArea('local'),
    onChanged: {
      addListener: (fn: typeof onChangedListeners extends Set<infer T> ? T : never) => onChangedListeners.add(fn),
      removeListener: (fn: typeof onChangedListeners extends Set<infer T> ? T : never) => onChangedListeners.delete(fn),
    },
  },
});

import { onSyncChange, getSync, setSync, onStorageChanged } from '../../src/platform/storage';

function emitChange(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  onChangedListeners.forEach(fn => fn(changes, area));
}

describe('platform/storage', () => {
  beforeEach(() => {
    onChangedListeners.clear();
    stores.sync = {};
    stores.session = {};
    stores.local = {};
  });

  // ==========================================================================
  // onSyncChange
  // ==========================================================================
  describe('onSyncChange', () => {
    it('fires callback when the watched key changes in sync area', () => {
      const cb = vi.fn();
      onSyncChange('apiKey', cb);

      emitChange({ apiKey: { newValue: 'sk-new', oldValue: 'sk-old' } }, 'sync');

      expect(cb).toHaveBeenCalledWith('sk-new');
    });

    it('does NOT fire for changes to other keys', () => {
      const cb = vi.fn();
      onSyncChange('apiKey', cb);

      emitChange({ otherKey: { newValue: 'x' } }, 'sync');

      expect(cb).not.toHaveBeenCalled();
    });

    it('does NOT fire for changes in local/session area', () => {
      const cb = vi.fn();
      onSyncChange('apiKey', cb);

      emitChange({ apiKey: { newValue: 'x' } }, 'local');
      emitChange({ apiKey: { newValue: 'x' } }, 'session');

      expect(cb).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function that stops callbacks', () => {
      const cb = vi.fn();
      const unsub = onSyncChange('apiKey', cb);

      emitChange({ apiKey: { newValue: 'a' } }, 'sync');
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();

      emitChange({ apiKey: { newValue: 'b' } }, 'sync');
      expect(cb).toHaveBeenCalledTimes(1); // still 1, not 2
    });
  });

  // ==========================================================================
  // onStorageChanged (generic)
  // ==========================================================================
  describe('onStorageChanged', () => {
    it('registers a raw listener and returns unsubscribe', () => {
      const cb = vi.fn();
      const unsub = onStorageChanged(cb);

      emitChange({ k: { newValue: 1 } }, 'sync');

      expect(cb).toHaveBeenCalledWith({ k: { newValue: 1 } }, 'sync');

      unsub();
      emitChange({ k: { newValue: 2 } }, 'sync');
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // getSync / setSync (smoke — verifies delegation to chrome.storage)
  // ==========================================================================
  describe('getSync / setSync', () => {
    it('reads written values back', async () => {
      await setSync({ myKey: 'myValue' });
      const result = await getSync<Record<string, unknown>>(['myKey']);
      expect(result.myKey).toBe('myValue');
    });
  });
});
