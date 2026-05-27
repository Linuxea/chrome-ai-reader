/**
 * Reusable chrome API mock for Vitest tests.
 * Covers: chrome.storage.sync/session/local, chrome.tabs, chrome.runtime.
 */

// Creates a programmable mock port for chrome.runtime.connect
// Tests can call _simulateMessage / _simulateDisconnect to trigger listeners
export function createMockPort(name) {
  const listeners = {
    onMessage: new Set(),
    onDisconnect: new Set(),
  };
  return {
    name,
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(fn => listeners.onMessage.add(fn)),
      removeListener: vi.fn(fn => listeners.onMessage.delete(fn)),
    },
    onDisconnect: {
      addListener: vi.fn(fn => listeners.onDisconnect.add(fn)),
      removeListener: vi.fn(fn => listeners.onDisconnect.delete(fn)),
    },
    disconnect: vi.fn(),
    _simulateMessage(msg) { listeners.onMessage.forEach(fn => fn(msg)); },
    _simulateDisconnect() { listeners.onDisconnect.forEach(fn => fn()); },
    _listeners: listeners,
  };
}

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
        // Handle null/undefined keys — return full store contents per Chrome API
        if (keys == null) {
          Object.assign(result, store[storeKey]);
        } else {
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach(k => {
            if (store[storeKey][k] !== undefined) result[k] = store[storeKey][k];
          });
        }
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
      onActivated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      // Returns a programmable mock port — tests can use
      // port._simulateMessage(msg) / port._simulateDisconnect()
      connect: vi.fn(() => createMockPort()),
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
