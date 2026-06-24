import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/platform/tabs.js', () => ({
  getActiveTab: vi.fn(),
}));

import { captureVisibleTab } from '../../../src/side_panel/services/screenshot';
import { getActiveTab } from '../../../src/platform/tabs.js';

describe('services/screenshot', () => {
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
