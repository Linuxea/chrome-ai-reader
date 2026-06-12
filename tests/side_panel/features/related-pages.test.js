import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome APIs
vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    },
  },
  runtime: {
    connect: vi.fn(() => ({
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    })),
  },
  tabs: {
    create: vi.fn(),
  },
});

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key, params) => {
    if (params) {
      return `[${key}](${JSON.stringify(params)})`;
    }
    return `[${key}]`;
  },
}));

vi.mock('../../../src/shared/constants.js', () => ({
  escapeHtml: (text) => text,
}));

vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: { SAVE_CURRENT_CHAT: 'SAVE_CURRENT_CHAT' },
}));

import { cosineSimilarity, requestEmbedding, findRelatedPages, clearAllPageRecords } from '../../../src/side_panel/features/related-pages.js';

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
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.99);
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
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.9);
  });
});

describe('requestEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.get.mockResolvedValue({ embeddingEnabled: true });
    chrome.storage.local.get.mockResolvedValue({});
  });

  it('skips when text is too short', async () => {
    await requestEmbedding('short', 'https://example.com', 'Test');
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('skips when embedding is disabled', async () => {
    chrome.storage.sync.get.mockResolvedValue({ embeddingEnabled: false });
    await requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('connects to embedding port and sends text', async () => {
    const mockPort = {
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    chrome.runtime.connect.mockReturnValue(mockPort);

    // requestEmbedding is async — it awaits storage.get before connect
    // Flush microtasks so the async function reaches chrome.runtime.connect
    const promise = requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'embedding' });
    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'embed', text: expect.any(String) })
    );

    // Trigger disconnect to resolve the promise
    const disconnectCb = mockPort.onDisconnect.addListener.mock.calls[0][0];
    disconnectCb();
    await promise;
  });

  it('stores page record on embedding response', async () => {
    const mockPort = {
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    chrome.runtime.connect.mockReturnValue(mockPort);
    chrome.storage.local.get.mockResolvedValue({ pageRecords: [] });

    const promise = requestEmbedding('a'.repeat(200), 'https://example.com', 'Test Page');
    await new Promise((r) => setTimeout(r, 0));

    // Simulate embedding response
    const msgCb = mockPort.onMessage.addListener.mock.calls[0][0];
    await msgCb({ type: 'embedding', embedding: [0.1, 0.2, 0.3] });

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const setCall = chrome.storage.local.set.mock.calls[0][0];
    const records = setCall.pageRecords;
    expect(records).toHaveLength(1);
    expect(records[0].url).toBe('https://example.com');
    expect(records[0].title).toBe('Test Page');
    expect(records[0].embedding).toEqual([0.1, 0.2, 0.3]);

    await promise;
  });

  it('handles embedding error gracefully', async () => {
    const mockPort = {
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    chrome.runtime.connect.mockReturnValue(mockPort);

    const promise = requestEmbedding('a'.repeat(200), 'https://example.com', 'Test');
    await new Promise((r) => setTimeout(r, 0));

    // Simulate error response
    const msgCb = mockPort.onMessage.addListener.mock.calls[0][0];
    await msgCb({ type: 'error', errorKey: 'error.something' });

    // Should not crash, should disconnect
    expect(mockPort.disconnect).toHaveBeenCalled();
    await promise;
  });
});

describe('findRelatedPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no records exist', async () => {
    chrome.storage.local.get.mockResolvedValue({ pageRecords: [] });
    const result = await findRelatedPages('https://example.com');
    expect(result).toEqual([]);
  });

  it('returns empty array when current page has no embedding', async () => {
    chrome.storage.local.get.mockResolvedValue({
      pageRecords: [{ url: 'https://example.com', title: 'Test', excerpt: 'content', id: '1', timestamp: 1000 }],
    });
    const result = await findRelatedPages('https://example.com');
    expect(result).toEqual([]);
  });

  it('finds related pages above threshold', async () => {
    chrome.storage.sync.get.mockResolvedValue({ embeddingThreshold: 0.7 });
    chrome.storage.local.get.mockResolvedValue({
      pageRecords: [
        { url: 'https://current.com', title: 'Current', excerpt: 'c', id: '1', timestamp: 1000, embedding: [1, 0, 0] },
        { url: 'https://related.com', title: 'Related', excerpt: 'r', id: '2', timestamp: 2000, embedding: [1, 0.1, 0] },
        { url: 'https://unrelated.com', title: 'Unrelated', excerpt: 'u', id: '3', timestamp: 3000, embedding: [0, 1, 0] },
      ],
    });

    const result = await findRelatedPages('https://current.com');
    expect(result).toHaveLength(1);
    expect(result[0].record.url).toBe('https://related.com');
    expect(result[0].similarity).toBeGreaterThan(0.9);
  });

  it('sorts results by similarity descending', async () => {
    chrome.storage.sync.get.mockResolvedValue({ embeddingThreshold: 0.5 });
    chrome.storage.local.get.mockResolvedValue({
      pageRecords: [
        { url: 'https://current.com', title: 'C', excerpt: 'c', id: '1', timestamp: 1000, embedding: [1, 0, 0] },
        { url: 'https://a.com', title: 'A', excerpt: 'a', id: '2', timestamp: 2000, embedding: [1, 0.5, 0] },
        { url: 'https://b.com', title: 'B', excerpt: 'b', id: '3', timestamp: 3000, embedding: [1, 0.2, 0] },
      ],
    });

    const result = await findRelatedPages('https://current.com');
    expect(result).toHaveLength(2);
    expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
  });

  it('limits results to top 5', async () => {
    chrome.storage.sync.get.mockResolvedValue({ embeddingThreshold: 0.5 });
    const records = [
      { url: 'https://current.com', title: 'C', excerpt: 'c', id: '0', timestamp: 0, embedding: [1, 0, 0] },
    ];
    for (let i = 1; i <= 10; i++) {
      records.push({
        url: `https://page${i}.com`, title: `P${i}`, excerpt: 'x',
        id: `${i}`, timestamp: i * 1000, embedding: [1, 0.1 * i, 0],
      });
    }
    chrome.storage.local.get.mockResolvedValue({ pageRecords: records });

    const result = await findRelatedPages('https://current.com');
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

describe('clearAllPageRecords', () => {
  it('removes page records from storage', async () => {
    await clearAllPageRecords();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('pageRecords');
  });
});
