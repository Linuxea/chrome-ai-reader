import { vi, describe, it, expect, beforeEach } from 'vitest';

const store = { sync: {} };

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      // Supports both promise-style and callback-style consumers (sw-ocr uses callbacks).
      get(keys, callback) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store.sync[k] !== undefined) result[k] = store.sync[k]; });
        if (typeof callback === 'function') { callback(result); return; }
        return Promise.resolve(result);
      },
    },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
});

vi.mock('../../src/background/sw-related-pages.js', () => ({
  searchByEmbedding: vi.fn(),
}));

import { ALL_TOOLS, TOOL_NAMES, getEnabledTools } from '../../src/background/llm/tools.js';
import { searchByEmbedding } from '../../src/background/sw-related-pages.js';

describe('background/llm/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.sync = {};
  });

  describe('getEnabledTools', () => {
    it('filters the registry down to enabled names', () => {
      const tools = getEnabledTools([TOOL_NAMES.READ_PAGE, 'no_such_tool']);
      expect(Object.keys(tools)).toEqual([TOOL_NAMES.READ_PAGE]);
    });

    it('returns an empty set for undefined/empty input', () => {
      expect(Object.keys(getEnabledTools(undefined))).toEqual([]);
      expect(Object.keys(getEnabledTools([]))).toEqual([]);
    });

    it('registry contains exactly the three first-batch tools', () => {
      expect(Object.keys(ALL_TOOLS).sort()).toEqual(['find_related_pages', 'ocr_image', 'read_page']);
    });
  });

  describe('read_page.execute', () => {
    it('extracts via the content script of the active tab', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 7 }]);
      chrome.tabs.sendMessage.mockResolvedValue({ success: true, data: { title: 'T', textContent: 'body' } });

      const out = await ALL_TOOLS[TOOL_NAMES.READ_PAGE].execute({ tabId: undefined }, { toolCallId: 'c1' });
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'extract' });
      expect(JSON.parse(out)).toEqual({ title: 'T', textContent: 'body' });
    });

    it('uses the explicit tabId when given', async () => {
      chrome.tabs.sendMessage.mockResolvedValue({ success: true, data: { title: 'T', textContent: 'b' } });
      await ALL_TOOLS[TOOL_NAMES.READ_PAGE].execute({ tabId: 42 }, { toolCallId: 'c' });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'extract' });
      expect(chrome.tabs.query).not.toHaveBeenCalled();
    });

    it('caps very long pages with a truncation marker', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.tabs.sendMessage.mockResolvedValue({ success: true, data: { title: 'T', textContent: 'x'.repeat(20000) } });

      const out = await ALL_TOOLS[TOOL_NAMES.READ_PAGE].execute({ tabId: undefined }, { toolCallId: 'c' });
      const parsed = JSON.parse(out);
      expect(parsed.textContent.length).toBeLessThan(15200);
      expect(parsed.textContent).toContain('truncated');
    });

    it('returns an error string (never throws) when extraction fails', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.tabs.sendMessage.mockRejectedValue(new Error('receiving end does not exist'));

      const out = await ALL_TOOLS[TOOL_NAMES.READ_PAGE].execute({ tabId: undefined }, { toolCallId: 'c' });
      expect(out).toContain('Error: tool read_page failed');
    });
  });

  describe('find_related_pages.execute', () => {
    it('embeds the query and ranks via searchByEmbedding with the configured threshold', async () => {
      store.sync = { embeddingApiKey: 'k', embeddingApiBase: 'https://e.test', embeddingModel: 'm', embeddingThreshold: 0.55 };
      const embedding = [0.1, 0.2];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 }),
      );
      searchByEmbedding.mockResolvedValue([
        { record: { title: 'A', url: 'https://a', excerpt: 'ea', embedding: [] }, similarity: 0.9 },
      ]);

      await ALL_TOOLS[TOOL_NAMES.FIND_RELATED_PAGES].execute({ query: 'topic', limit: 5 }, { toolCallId: 'c' });
      expect(searchByEmbedding).toHaveBeenCalledWith(embedding, 0.55, 5);
      vi.mocked(fetch).mockRestore();
    });

    it('defaults the threshold to 0.7 when not configured', async () => {
      store.sync = { embeddingApiKey: 'k', embeddingApiBase: 'https://e.test', embeddingModel: 'm' };
      const embedding = [0.1];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 }),
      );
      searchByEmbedding.mockResolvedValue([]);

      await ALL_TOOLS[TOOL_NAMES.FIND_RELATED_PAGES].execute({ query: 'topic', limit: 5 }, { toolCallId: 'c' });
      expect(searchByEmbedding).toHaveBeenCalledWith(embedding, 0.7, 5);
      vi.mocked(fetch).mockRestore();
    });

    it('returns the ranked records as JSON', async () => {
      store.sync = { embeddingApiKey: 'k', embeddingApiBase: 'https://e.test', embeddingModel: 'm' };
      const embedding = [0.1, 0.2];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 }),
      );
      searchByEmbedding.mockResolvedValue([
        { record: { title: 'A', url: 'https://a', excerpt: 'ea', embedding: [] }, similarity: 0.9 },
      ]);

      const out = await ALL_TOOLS[TOOL_NAMES.FIND_RELATED_PAGES].execute({ query: 'topic', limit: 5 }, { toolCallId: 'c' });
      expect(JSON.parse(out)).toEqual([{ title: 'A', url: 'https://a', excerpt: 'ea', similarity: 0.9 }]);
      vi.mocked(fetch).mockRestore();
    });

    it('surfaces unconfigured embedding as an error string', async () => {
      store.sync = {};
      const out = await ALL_TOOLS[TOOL_NAMES.FIND_RELATED_PAGES].execute({ query: 'q', limit: 5 }, { toolCallId: 'c' });
      expect(out).toContain('embedding-not-configured');
    });
  });

  describe('ocr_image.execute', () => {
    it('strips data: URI prefixes before calling the OCR endpoint', async () => {
      store.sync = { ocrApiKey: 'ocr-key' };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { text: 'recognized' } }), { status: 200 }),
      );

      const out = await ALL_TOOLS[TOOL_NAMES.OCR_IMAGE].execute({ imageBase64: 'data:image/png;base64,QUJD' }, { toolCallId: 'c' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.file).toBe('QUJD'); // prefix stripped
      expect(JSON.parse(out)).toEqual({ success: true, data: { text: 'recognized' } });
      fetchMock.mockRestore();
    });

    it('returns error string when OCR key missing', async () => {
      store.sync = {};
      const out = await ALL_TOOLS[TOOL_NAMES.OCR_IMAGE].execute({ imageBase64: 'QUJD' }, { toolCallId: 'c' });
      expect(out).toContain('Error: tool ocr_image failed');
    });
  });
});
