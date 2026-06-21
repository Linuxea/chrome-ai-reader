import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Chrome API mock --------------------------------------------------------
// The feature now goes through platform/ports + platform/storage, but both
// ultimately call chrome.* — mocking at the global level still works and
// matches the convention in tests/platform/*.
const store = { sync: {}, local: {} };

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get: vi.fn((keys) => Promise.resolve(
        (Array.isArray(keys) ? keys : [keys]).reduce((acc, k) => { acc[k] = store.sync[k]; return acc; }, {})
      )),
      set: vi.fn((items) => { Object.assign(store.sync, items); return Promise.resolve(); }),
    },
    local: {
      get: vi.fn((keys) => Promise.resolve(
        (Array.isArray(keys) ? keys : [keys]).reduce((acc, k) => { acc[k] = store.local[k]; return acc; }, {})
      )),
      set: vi.fn((items) => { Object.assign(store.local, items); return Promise.resolve(); }),
      remove: vi.fn((keys) => {
        for (const k of (Array.isArray(keys) ? keys : [keys])) delete store.local[k];
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    connect: vi.fn(() => ({
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    })),
    openOptionsPage: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(() => Promise.resolve([])),
  },
});

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key, params) => {
    if (params) return `[${key}](${JSON.stringify(params)})`;
    return `[${key}]`;
  },
}));

vi.mock('../../../src/shared/constants.js', () => ({
  escapeHtml: (text) => String(text),
}));

vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  on: vi.fn(),
  EVENTS: { PAGE_EXTRACTED: 'pageExtracted', SHOW_RELATED_PAGES: 'showRelatedPages' },
}));

import {
  cosineSimilarity,
  requestEmbedding,
  findRelatedPages,
  clearAllPageRecords,
  renderRelatedPages,
  initRelatedPages,
  resetState,
  dropLegacyRecords,
  __internals,
} from '../../../src/side_panel/features/related-pages.js';

// Helper: install a fully-programmable mock port that captures listeners.
function mockPort() {
  const listeners = { message: null, disconnect: null };
  const port = {
    onMessage: { addListener: vi.fn((fn) => { listeners.message = fn; }) },
    onDisconnect: { addListener: vi.fn((fn) => { listeners.disconnect = fn; }) },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  };
  port._listeners = listeners;
  return port;
}

// Reset all state between tests.
beforeEach(() => {
  vi.clearAllMocks();
  // Wipe storage.
  for (const k of Object.keys(store.sync)) delete store.sync[k];
  for (const k of Object.keys(store.local)) delete store.local[k];
  // Default to a fully-configured, enabled embedding service.
  store.sync.embeddingEnabled = true;
  store.sync.embeddingApiKey = 'sk-emb';
  store.sync.embeddingApiBase = 'https://emb.example.com/v1';
  store.sync.embeddingModel = 'text-embedding-3-small';
  store.sync.embeddingThreshold = 0.7;
  store.sync.embeddingMaxPages = 200;
  resetState();
});

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 5);
  });

  it('returns ~1.0 for nearly identical vectors', () => {
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.15, 0.25, 0.35, 0.45];
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.99);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for different length vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('handles negative values', () => {
    const a = [-0.5, 0.3, -0.2];
    const b = [-0.4, 0.4, -0.1];
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.9);
  });
});

describe('requestEmbedding', () => {
  it('skips when text is too short', async () => {
    await requestEmbedding('short', 'https://example.com', 'Test');
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('skips when embedding is disabled', async () => {
    store.sync.embeddingEnabled = false;
    await requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('skips silently when config is incomplete (no apiKey)', async () => {
    delete store.sync.embeddingApiKey;
    await requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('skips silently when config is incomplete (no model)', async () => {
    delete store.sync.embeddingModel;
    await requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('connects to embedding port and posts EmbeddingRequest', async () => {
    const port = mockPort();
    chrome.runtime.connect.mockReturnValue(port);

    const promise = requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'embedding' });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'embed', text: expect.any(String) })
    );

    // disconnect to settle the promise
    port._listeners.disconnect();
    await promise;
  });

  it('stores a page record with normalizedUrl on embedding response', async () => {
    const port = mockPort();
    chrome.runtime.connect.mockReturnValue(port);

    const promise = requestEmbedding('a'.repeat(200), 'https://example.com/post?utm_source=foo#x', 'Test');
    await new Promise((r) => setTimeout(r, 0));

    await port._listeners.message({ type: 'embedding', embedding: [0.1, 0.2, 0.3] });

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const setCall = chrome.storage.local.set.mock.calls[0][0];
    const records = setCall.pageRecords;
    expect(records).toHaveLength(1);
    // raw URL preserved
    expect(records[0].url).toBe('https://example.com/post?utm_source=foo#x');
    // normalizedUrl used for matching/dedup
    expect(records[0].normalizedUrl).toBe('https://example.com/post');
    expect(records[0].title).toBe('Test');
    expect(records[0].embedding).toEqual([0.1, 0.2, 0.3]);

    await promise;
  });

  it('does not duplicate records for the same normalizedUrl', async () => {
    // Seed an existing record for the same normalized URL.
    // normalizeUrl('https://example.com/post?utm_source=x') === 'https://example.com/post'
    store.local.pageRecords = [{
      id: 'old', url: 'https://example.com/post',
      normalizedUrl: 'https://example.com/post',
      title: 'Old', excerpt: 'old', embedding: [1, 0, 0], timestamp: 1000,
    }];

    const port = mockPort();
    chrome.runtime.connect.mockReturnValue(port);

    // Same page visited with utm param — normalizes to the same key.
    const promise = requestEmbedding('a'.repeat(200), 'https://example.com/post?utm_source=news', 'New Title');
    await new Promise((r) => setTimeout(r, 0));
    await port._listeners.message({ type: 'embedding', embedding: [0.5, 0.5, 0] });

    const setCall = chrome.storage.local.set.mock.calls[0][0];
    expect(setCall.pageRecords).toHaveLength(1);
    // Updated in place (title changed), id preserved.
    expect(setCall.pageRecords[0].id).toBe('old');
    expect(setCall.pageRecords[0].title).toBe('New Title');

    await promise;
  });

  it('surfaces error to state and disconnects', async () => {
    const port = mockPort();
    chrome.runtime.connect.mockReturnValue(port);

    const promise = requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    await new Promise((r) => setTimeout(r, 0));

    await port._listeners.message({ type: 'error', errorKey: 'error.emptyEmbedding' });

    expect(__internals.getState().status).toBe('error');
    expect(__internals.getState().errorKey).toBe('error.emptyEmbedding');
    expect(port.disconnect).toHaveBeenCalled();

    await promise;
  });
});

describe('findRelatedPages', () => {
  it('returns empty array when no records exist', async () => {
    const result = await findRelatedPages('https://example.com');
    expect(result).toEqual([]);
  });

  it('returns empty array when current page has no matching normalizedUrl', async () => {
    store.local.pageRecords = [
      { url: 'https://other.com', normalizedUrl: 'https://other.com', title: 'Test', excerpt: 'content', id: '1', timestamp: 1000, embedding: [1, 0, 0] },
    ];
    const result = await findRelatedPages('https://example.com');
    expect(result).toEqual([]);
  });

  it('returns empty array when current page record has no embedding', async () => {
    store.local.pageRecords = [
      { url: 'https://example.com', normalizedUrl: 'https://example.com', title: 'Test', excerpt: 'content', id: '1', timestamp: 1000 },
    ];
    const result = await findRelatedPages('https://example.com');
    expect(result).toEqual([]);
  });

  it('finds related pages above threshold (matched by normalizedUrl)', async () => {
    store.sync.embeddingThreshold = 0.7;
    store.local.pageRecords = [
      { url: 'https://current.com', normalizedUrl: 'https://current.com', title: 'Current', excerpt: 'c', id: '1', timestamp: 1000, embedding: [1, 0, 0] },
      { url: 'https://related.com', normalizedUrl: 'https://related.com', title: 'Related', excerpt: 'r', id: '2', timestamp: 2000, embedding: [1, 0.1, 0] },
      { url: 'https://unrelated.com', normalizedUrl: 'https://unrelated.com', title: 'Unrelated', excerpt: 'u', id: '3', timestamp: 3000, embedding: [0, 1, 0] },
    ];

    const result = await findRelatedPages('https://current.com');
    expect(result).toHaveLength(1);
    expect(result[0].record.url).toBe('https://related.com');
    expect(result[0].similarity).toBeGreaterThan(0.9);
  });

  it('sorts results by similarity descending', async () => {
    store.sync.embeddingThreshold = 0.5;
    store.local.pageRecords = [
      { url: 'https://current.com', normalizedUrl: 'https://current.com', title: 'C', excerpt: 'c', id: '1', timestamp: 1000, embedding: [1, 0, 0] },
      { url: 'https://a.com', normalizedUrl: 'https://a.com', title: 'A', excerpt: 'a', id: '2', timestamp: 2000, embedding: [1, 0.5, 0] },
      { url: 'https://b.com', normalizedUrl: 'https://b.com', title: 'B', excerpt: 'b', id: '3', timestamp: 3000, embedding: [1, 0.2, 0] },
    ];

    const result = await findRelatedPages('https://current.com');
    expect(result).toHaveLength(2);
    expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
  });

  it('limits results to top 5', async () => {
    store.sync.embeddingThreshold = 0.5;
    const records = [
      { url: 'https://current.com', normalizedUrl: 'https://current.com', title: 'C', excerpt: 'c', id: '0', timestamp: 0, embedding: [1, 0, 0] },
    ];
    for (let i = 1; i <= 10; i++) {
      records.push({
        url: `https://page${i}.com`, normalizedUrl: `https://page${i}.com`, title: `P${i}`, excerpt: 'x',
        id: `${i}`, timestamp: i * 1000, embedding: [1, 0.1 * i, 0],
      });
    }
    store.local.pageRecords = records;

    const result = await findRelatedPages('https://current.com');
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('treats the same URL with different utm params as the same page', async () => {
    store.sync.embeddingThreshold = 0.5;
    store.local.pageRecords = [
      { url: 'https://example.com/post', normalizedUrl: 'https://example.com/post', title: 'Post', excerpt: 'p', id: '1', timestamp: 1000, embedding: [1, 0, 0] },
      { url: 'https://example.com/other', normalizedUrl: 'https://example.com/other', title: 'Other', excerpt: 'o', id: '2', timestamp: 2000, embedding: [1, 0.2, 0] },
    ];
    // Caller passes a URL with utm params — should still match the bare record.
    const result = await findRelatedPages('https://example.com/post?utm_source=news');
    expect(result).toHaveLength(1);
    expect(result[0].record.url).toBe('https://example.com/other');
  });
});

describe('dropLegacyRecords', () => {
  it('removes records that lack normalizedUrl', async () => {
    store.local.pageRecords = [
      { url: 'https://a.com', normalizedUrl: 'https://a.com', id: '1', title: 'a', excerpt: 'a', embedding: [1], timestamp: 1 },
      { url: 'https://b.com', id: '2', title: 'b', excerpt: 'b', embedding: [1], timestamp: 2 }, // legacy
    ];
    await dropLegacyRecords();
    expect(store.local.pageRecords).toHaveLength(1);
    expect(store.local.pageRecords[0].id).toBe('1');
  });

  it('does nothing when all records are already migrated', async () => {
    store.local.pageRecords = [
      { url: 'https://a.com', normalizedUrl: 'https://a.com', id: '1', title: 'a', excerpt: 'a', embedding: [1], timestamp: 1 },
    ];
    chrome.storage.local.set.mockClear();
    await dropLegacyRecords();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe('clearAllPageRecords', () => {
  it('removes the pageRecords key from local storage', async () => {
    await clearAllPageRecords();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('pageRecords');
  });
});

// ---------------------------------------------------------------------------
// DOM-driven tests (jsdom) — exercise initRelatedPages + renderRelatedPages
// state transitions.
// ---------------------------------------------------------------------------

describe('initRelatedPages', () => {
  it('creates and inserts the panel DOM after chatArea', () => {
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });
    const panel = document.getElementById('relatedPagesPanel');
    expect(panel).not.toBeNull();
    expect(panel.nextElementSibling).toBeNull(); // inserted after chatArea, so no next sib
    expect(document.getElementById('relatedList')).not.toBeNull();
    expect(panel.querySelector('.related-toggle')).not.toBeNull();
    expect(panel.querySelector('.related-badge')).not.toBeNull();
  });

  it('toggles collapse on click', () => {
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });
    const btn = document.querySelector('.related-toggle');
    const list = document.getElementById('relatedList');
    expect(list.classList.contains('collapsed')).toBe(false);
    btn.click();
    expect(list.classList.contains('collapsed')).toBe(true);
    btn.click();
    expect(list.classList.contains('collapsed')).toBe(false);
  });
});

describe('renderRelatedPages', () => {
  it('shows disabled status when embeddingEnabled is false', async () => {
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });
    store.sync.embeddingEnabled = false;

    await renderRelatedPages('https://example.com');

    expect(__internals.getState().status).toBe('disabled');
    expect(document.getElementById('relatedList').textContent).toContain('[related.disabled]');
  });

  it('shows not-configured status when apiKey/base/model are missing', async () => {
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });
    delete store.sync.embeddingApiKey;

    await renderRelatedPages('https://example.com');

    expect(__internals.getState().status).toBe('not-configured');
    const html = document.getElementById('relatedList').innerHTML;
    expect(html).toContain('[related.notConfigured]');
    expect(html).toContain('related-settings-link');
  });

  it('shows loading then empty when there are no matches', async () => {
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });
    store.local.pageRecords = [];

    await renderRelatedPages('https://example.com');

    expect(__internals.getState().status).toBe('empty');
    expect(document.getElementById('relatedList').textContent).toContain('[related.empty]');
  });

  it('shows results when related pages exist', async () => {
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });
    store.sync.embeddingThreshold = 0.5;
    store.local.pageRecords = [
      { url: 'https://example.com', normalizedUrl: 'https://example.com', id: '1', title: 'Current', excerpt: 'c', embedding: [1, 0, 0], timestamp: Date.now() },
      { url: 'https://other.com', normalizedUrl: 'https://other.com', id: '2', title: 'Other', excerpt: 'o', embedding: [1, 0.1, 0], timestamp: Date.now() },
    ];

    await renderRelatedPages('https://example.com');

    expect(__internals.getState().status).toBe('results');
    const items = document.querySelectorAll('.related-item');
    expect(items).toHaveLength(1);
    expect(items[0].dataset.url).toBe('https://other.com');
  });

  it('clicking a related item opens the URL in a new tab', async () => {
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });
    store.sync.embeddingThreshold = 0.5;
    store.local.pageRecords = [
      { url: 'https://example.com', normalizedUrl: 'https://example.com', id: '1', title: 'Current', excerpt: 'c', embedding: [1, 0, 0], timestamp: Date.now() },
      { url: 'https://other.com', normalizedUrl: 'https://other.com', id: '2', title: 'Other', excerpt: 'o', embedding: [1, 0.1, 0], timestamp: Date.now() },
    ];

    await renderRelatedPages('https://example.com');
    chrome.tabs.create.mockClear();
    document.querySelector('.related-item').click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://other.com' });
  });
});

describe('auto-refresh after storePageRecord', () => {
  it('auto-refreshes the current view even when the stored record is for a different URL', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });

    // Current page has a record but no related pages exist yet.
    store.sync.embeddingThreshold = 0.5;
    store.local.pageRecords = [
      { url: 'https://example.com', normalizedUrl: 'https://example.com', id: '1', title: 'Current', excerpt: 'c', embedding: [1, 0, 0], timestamp: Date.now() },
    ];
    await renderRelatedPages('https://example.com');
    expect(__internals.getState().status).toBe('empty');
    expect(document.querySelectorAll('.related-item').length).toBe(0);

    // Storing a record for a DIFFERENT page should still refresh the current
    // view — the new page may be similar to what the user is viewing, so the
    // list must be recomputed. The badge must also clear.
    const port = mockPort();
    chrome.runtime.connect.mockReturnValue(port);
    const promise = requestEmbedding('a'.repeat(200), 'https://other.com', 'Other');
    await vi.advanceTimersByTimeAsync(0);
    await port._listeners.message({ type: 'embedding', embedding: [1, 0.1, 0] });
    await promise;

    // Badge lit by storePageRecord.
    expect(__internals.getState().hasNewRelations).toBe(true);

    // After the debounce window, the current view is refreshed and the
    // newly-stored page appears as a related item; the badge clears.
    await vi.advanceTimersByTimeAsync(500);
    expect(__internals.getState().status).toBe('results');
    expect(__internals.getState().hasNewRelations).toBe(false);
    expect(document.querySelectorAll('.related-item').length).toBe(1);
    expect(document.querySelector('.related-item').dataset.url).toBe('https://other.com');

    vi.useRealTimers();
  });

  it('auto-refreshes the panel when the current page is re-indexed', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="chatArea"></div>';
    initRelatedPages({ chatArea: document.getElementById('chatArea') });

    // Two related pages already exist; panel shows 1 related item.
    store.sync.embeddingThreshold = 0.5;
    const ts = Date.now();
    store.local.pageRecords = [
      { url: 'https://example.com', normalizedUrl: 'https://example.com', id: '0', title: 'Current', excerpt: 'c', embedding: [1, 0, 0], timestamp: ts },
      { url: 'https://other.com', normalizedUrl: 'https://other.com', id: '1', title: 'Other', excerpt: 'o', embedding: [1, 0.1, 0], timestamp: ts },
    ];
    await renderRelatedPages('https://example.com');
    expect(document.querySelectorAll('.related-item').length).toBe(1);

    // Re-store the current URL — the auto-refresh fires and refreshes the list.
    const port = mockPort();
    chrome.runtime.connect.mockReturnValue(port);
    const promise = requestEmbedding('a'.repeat(200), 'https://example.com', 'Current (updated)');
    await vi.advanceTimersByTimeAsync(0);
    await port._listeners.message({ type: 'embedding', embedding: [1, 0, 0] });
    await promise;

    await vi.advanceTimersByTimeAsync(400);
    expect(__internals.getState().status).toBe('results');
    expect(document.querySelectorAll('.related-item').length).toBe(1);

    vi.useRealTimers();
  });
});
