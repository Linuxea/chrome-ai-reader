import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/platform/tabs.js', () => ({
  getActiveTab: vi.fn(),
}));

import { captureVisibleTab, captureFullPage, MAX_SEGMENTS } from '../../../src/side_panel/services/screenshot';
import { getActiveTab } from '../../../src/platform/tabs.js';

function mockChrome(handlers: {
  captureVisibleTab?: ReturnType<typeof vi.fn>;
  sendMessage?: (msg: { action: string }) => unknown;
}): void {
  vi.stubGlobal('chrome', {
    tabs: {
      captureVisibleTab: handlers.captureVisibleTab ?? vi.fn(),
      sendMessage: vi.fn((tabId: number, msg: { action: string }) => {
        if (handlers.sendMessage) return Promise.resolve(handlers.sendMessage(msg));
        return Promise.resolve(undefined);
      }),
    },
  });
}

describe('services/screenshot captureVisibleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures the visible area of the active tab window', async () => {
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99, windowId: 7, url: 'https://example.com', title: 'Example',
    });
    const fakeDataUrl = 'data:image/png;base64,AAAA';
    vi.stubGlobal('chrome', {
      tabs: { captureVisibleTab: vi.fn().mockResolvedValue(fakeDataUrl) },
    });

    const result = await captureVisibleTab();

    expect(result).toBe(fakeDataUrl);
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
  });

  it('throws when there is no active tab windowId', async () => {
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: undefined, windowId: undefined, url: undefined, title: undefined,
    });

    await expect(captureVisibleTab()).rejects.toThrow();
  });

  it('propagates captureVisibleTab rejection', async () => {
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1, windowId: 2, url: 'https://x.com', title: 'X',
    });
    vi.stubGlobal('chrome', {
      tabs: { captureVisibleTab: vi.fn().mockRejectedValue(new Error('permission denied')) },
    });

    await expect(captureVisibleTab()).rejects.toThrow('permission denied');
  });
});

describe('services/screenshot captureFullPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 42, windowId: 7, url: 'https://example.com', title: 'Example',
    });
  });

  it('captures each viewport segment until the page reports atBottom, then restores', async () => {
    vi.useFakeTimers();
    // 2-screen page: top (0..800) → next → bottom (800..1600)
    const pages: Record<string, { y: number; innerHeight: number; scrollHeight: number; atBottom: boolean }> = {
      scrollBegin: { y: 0, innerHeight: 800, scrollHeight: 1600, atBottom: false },
      scrollNext: { y: 800, innerHeight: 800, scrollHeight: 1600, atBottom: true },
    };
    const actions: string[] = [];
    mockChrome({
      captureVisibleTab: vi
        .fn()
        .mockResolvedValueOnce('data:image/png;base64,ONE')
        .mockResolvedValueOnce('data:image/png;base64,TWO'),
      sendMessage: (msg) => {
        actions.push(msg.action);
        return pages[msg.action];
      },
    });

    const progress: Array<[number, number]> = [];
    let result!: { dataUris: string[]; error?: string };
    const run = captureFullPage((done, total) => progress.push([done, total])).then((r) => {
      result = r;
    });
    await vi.runAllTimersAsync();
    await run;

    expect(result.dataUris).toEqual(['data:image/png;base64,ONE', 'data:image/png;base64,TWO']);
    expect(result.error).toBeUndefined();
    expect(actions).toEqual(['scrollBegin', 'scrollNext', 'scrollRestore']);
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('captures a single segment when the page fits in one viewport', async () => {
    vi.useFakeTimers();
    mockChrome({
      captureVisibleTab: vi.fn().mockResolvedValue('data:image/png;base64,ONE'),
      sendMessage: () => ({ y: 0, innerHeight: 900, scrollHeight: 700, atBottom: true }),
    });

    let result!: { dataUris: string[]; error?: string };
    const run = captureFullPage().then((r) => {
      result = r;
    });
    await vi.runAllTimersAsync();
    await run;

    expect(result.dataUris).toHaveLength(1);
    expect(result.error).toBeUndefined();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'scrollRestore' });
    vi.useRealTimers();
  });

  it('stops at MAX_SEGMENTS on never-ending pages', async () => {
    vi.useFakeTimers();
    mockChrome({
      captureVisibleTab: vi.fn().mockResolvedValue('data:image/png;base64,X'),
      // Infinite scroll: every next() reveals a taller page, never at bottom.
      sendMessage: (msg) => {
        if (msg.action === 'scrollBegin') return { y: 0, innerHeight: 800, scrollHeight: 1_000_000, atBottom: false };
        return { y: 800, innerHeight: 800, scrollHeight: 1_000_000, atBottom: false };
      },
    });

    let result!: { dataUris: string[]; error?: string };
    const run = captureFullPage().then((r) => {
      result = r;
    });
    await vi.runAllTimersAsync();
    await run;

    expect(result.dataUris).toHaveLength(MAX_SEGMENTS);
    expect(result.error).toBeUndefined();
    // 15 captures + begin + 14 nexts + restore
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1 + (MAX_SEGMENTS - 1) + 1);
    vi.useRealTimers();
  });

  it('reports an error and no captures when the content script is unreachable', async () => {
    vi.useFakeTimers();
    mockChrome({
      captureVisibleTab: vi.fn(),
      sendMessage: () => Promise.reject(new Error('Could not establish connection')),
    });

    let result!: { dataUris: string[]; error?: string };
    const run = captureFullPage().then((r) => {
      result = r;
    });
    await vi.runAllTimersAsync();
    await run;

    expect(result.dataUris).toEqual([]);
    expect(result.error).toContain('Could not establish connection');
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps partial captures and still restores when the loop fails mid-run', async () => {
    vi.useFakeTimers();
    let nextCalls = 0;
    mockChrome({
      captureVisibleTab: vi
        .fn()
        .mockResolvedValueOnce('data:image/png;base64,ONE')
        .mockRejectedValueOnce(new Error('capture denied')),
      sendMessage: (msg) => {
        if (msg.action === 'scrollNext') {
          nextCalls++;
          return { y: 800, innerHeight: 800, scrollHeight: 1600, atBottom: false };
        }
        if (msg.action === 'scrollBegin') return { y: 0, innerHeight: 800, scrollHeight: 1600, atBottom: false };
        return { ok: true };
      },
    });

    let result!: { dataUris: string[]; error?: string };
    const run = captureFullPage().then((r) => {
      result = r;
    });
    await vi.runAllTimersAsync();
    await run;

    expect(result.dataUris).toEqual(['data:image/png;base64,ONE']);
    expect(result.error).toContain('capture denied');
    expect(nextCalls).toBe(1);
    // restore must still fire
    const calls = (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => c[1].action === 'scrollRestore')).toBe(true);
    vi.useRealTimers();
  });

  it('rejects malformed scroll state responses', async () => {
    vi.useFakeTimers();
    mockChrome({
      captureVisibleTab: vi.fn(),
      sendMessage: () => undefined,
    });

    let result!: { dataUris: string[]; error?: string };
    const run = captureFullPage().then((r) => {
      result = r;
    });
    await vi.runAllTimersAsync();
    await run;

    expect(result.dataUris).toEqual([]);
    expect(result.error).toContain('scrollBegin');
    vi.useRealTimers();
  });

  it('returns an error without messaging when there is no active tab', async () => {
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: undefined, windowId: undefined, url: undefined, title: undefined,
    });
    mockChrome({});

    const result = await captureFullPage();

    expect(result.dataUris).toEqual([]);
    expect(result.error).toBe('No active tab');
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
