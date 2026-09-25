import { vi, describe, it, expect, beforeEach } from 'vitest';

const { tabState } = vi.hoisted(() => ({ tabState: { pageParagraphs: ['Intro.', 'The cited passage.'] } as Record<string, unknown> }));
vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../src/side_panel/state.js', () => ({ getActiveTabId: () => 7, getStateForTab: () => tabState }));
vi.mock('../../../src/side_panel/ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/platform/messaging.js', () => ({ sendToContentScript: vi.fn() }));

import { jumpToParagraph } from '../../../src/side_panel/features/citations';
import { sendToContentScript } from '../../../src/platform/messaging.js';
import { showToast } from '../../../src/side_panel/ui/toast.js';

beforeEach(() => vi.clearAllMocks());

describe('features/citations jumpToParagraph', () => {
  it('asks the content script to highlight the cited paragraph text', async () => {
    vi.mocked(sendToContentScript).mockResolvedValueOnce({ ok: true });
    expect(await jumpToParagraph(1)).toBe(true);
    expect(sendToContentScript).toHaveBeenCalledWith(7, { action: 'highlightParagraph', text: 'The cited passage.' });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('explains when the paragraph is unknown or not found on the page', async () => {
    expect(await jumpToParagraph(99)).toBe(false);
    expect(showToast).toHaveBeenLastCalledWith('[citation.unavailable]', 2500);
    vi.mocked(sendToContentScript).mockResolvedValueOnce({ ok: false });
    expect(await jumpToParagraph(0)).toBe(false);
    expect(showToast).toHaveBeenLastCalledWith('[citation.notFound]', 2500);
  });
});
