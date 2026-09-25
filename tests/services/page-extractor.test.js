import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../src/side_panel/ui/toast.js', () => ({
  showExtractingToast: vi.fn(),
}));

vi.mock('../../src/side_panel/state.js', () => ({
  getActiveTabId: vi.fn(() => 42),
  getStateForTab: vi.fn(() => ({ pageContent: '', pageExcerpt: '', pageTitle: '' })),
  persistForTab: vi.fn(),
}));

// Chrome mock via vi.hoisted so it's available at import time
vi.hoisted(() => {
  globalThis.chrome = {
    tabs: { sendMessage: vi.fn(() => Promise.resolve({ success: true })), get: vi.fn(() => Promise.resolve({ url: 'https://example.com' })) },
  };
});

import { extractPageContent } from '../../src/side_panel/services/page-extractor.js';

describe('extractPageContent', () => {
  const successResponse = {
    success: true,
    data: {
      textContent: 'page body text',
      excerpt: 'short summary',
      title: 'Page Title',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chrome.tabs.sendMessage.mockResolvedValue(successResponse);
  });

  it('sends extract message to the correct tab via expectTabId', async () => {
    await extractPageContent(99);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, { action: 'extract' });
  });

  it('falls back to getActiveTabId when expectTabId is omitted', async () => {
    await extractPageContent();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'extract' });
  });

  it('returns error result when no tabId is available', async () => {
    const { getActiveTabId } = await import('../../src/side_panel/state.js');
    getActiveTabId.mockReturnValue(null);
    const result = await extractPageContent();
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('[error.noTab]');
  });

  it('returns error result when response indicates failure', async () => {
    chrome.tabs.sendMessage.mockResolvedValue({ success: false, error: 'content script error' });
    const result = await extractPageContent(42);
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('content script error');
  });

  it('returns error result with default message when response is failure without error', async () => {
    chrome.tabs.sendMessage.mockResolvedValue({ success: false });
    const result = await extractPageContent(42);
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('[error.extractFailed]');
  });

  it('returns error result when response is null', async () => {
    chrome.tabs.sendMessage.mockResolvedValue(null);
    const result = await extractPageContent(42);
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('[error.extractFailed]');
  });

  it('writes page data to tabState and persists', async () => {
    const { getStateForTab, persistForTab } = await import('../../src/side_panel/state.js');
    const ts = {};
    getStateForTab.mockReturnValue(ts);
    await extractPageContent(42);
    expect(ts.pageContent).toBe('page body text');
    expect(ts.pageExcerpt).toBe('short summary');
    expect(ts.pageTitle).toBe('Page Title');
    expect(persistForTab).toHaveBeenCalledWith(42);
  });

  it('returns response data on success', async () => {
    const result = await extractPageContent(42);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(successResponse.data);
  });

  it('skips state update when tabState is null (unknown tab)', async () => {
    const { getStateForTab, persistForTab } = await import('../../src/side_panel/state.js');
    getStateForTab.mockReturnValue(null);
    const result = await extractPageContent(42);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(successResponse.data);
    expect(persistForTab).not.toHaveBeenCalled();
  });
});

describe('extractPageContent — missing content script', () => {
  it('injects content.js and retries when the tab has no content script yet', async () => {
    const { extractPageContent } = await import('../../src/side_panel/services/page-extractor.js');
    chrome.scripting = { executeScript: vi.fn(() => Promise.resolve()) };
    chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce({ success: true, data: { textContent: 'body', excerpt: 'ex', title: 'T' } });

    const result = await extractPageContent(7);

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['content.js'] });
    expect(result.ok).toBe(true);
  });

  it('reports a friendly error on pages that cannot host a content script', async () => {
    const { extractPageContent } = await import('../../src/side_panel/services/page-extractor.js');
    chrome.scripting = { executeScript: vi.fn(() => Promise.reject(new Error('Cannot access a chrome:// URL'))) };
    chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist'));

    const result = await extractPageContent(7);

    expect(result.ok).toBe(false);
    expect(result.error.message).toBe('[error.pageUnsupported]');
  });
});

describe('extractPageContent — PDF tabs (F3)', () => {
  it('reads a .pdf tab with pdf.js instead of the content script', async () => {
    vi.resetModules();
    vi.doMock('../../src/side_panel/services/pdf-extractor.js', () => ({
      extractPdf: vi.fn(async () => ({ ok: true, value: { title: 'P', textContent: 'pdf text', excerpt: 'pdf', paragraphs: ['pdf text'] } })),
      servesPdf: vi.fn(async () => false),
    }));
    const { extractPageContent } = await import('../../src/side_panel/services/page-extractor.js');
    const { getActiveTabId, getStateForTab } = await import('../../src/side_panel/state.js');
    getActiveTabId.mockReturnValue(5);
    const ts = {};
    getStateForTab.mockReturnValue(ts);
    chrome.tabs.get.mockResolvedValueOnce({ url: 'https://x.com/a.pdf' });
    chrome.tabs.sendMessage.mockClear();

    const result = await extractPageContent(5);

    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe('pdf');
    expect(ts.pageParagraphs).toEqual(['pdf text']);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    vi.doUnmock('../../src/side_panel/services/pdf-extractor.js');
  });
});
