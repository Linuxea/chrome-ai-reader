/**
 * Reusable chrome API mock for Vitest tests.
 * Covers: chrome.storage.sync/session/local, chrome.tabs, chrome.runtime.
 */
export function createChromeMock(overrides = {}) {
  const store = {
    sync: {},
    session: {},
    local: {},
  };

  const storageListeners = {
    sync: new Set(),
    session: new Set(),
    local: new Set(),
  };

  function createStorageArea(storeKey) {
    return {
      get(keys, cb) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
          if (store[storeKey][k] !== undefined) result[k] = store[storeKey][k];
        });
        cb?.(result);
      },
      set(items, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: store[storeKey][k], newValue: v };
          store[storeKey][k] = v;
        }
        storageListeners[storeKey].forEach(fn => fn(changes, storeKey));
        cb?.();
      },
      remove(keys, cb) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete store[storeKey][k]);
        cb?.();
      },
    };
  }

  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: {
        addListener(fn) {
          ['sync', 'session', 'local'].forEach(area => storageListeners[area].add(fn));
        },
        removeListener(fn) {
          ['sync', 'session', 'local'].forEach(area => storageListeners[area].delete(fn));
        },
      },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    ...overrides,
  };

  return { chrome, store, storageListeners };
}
