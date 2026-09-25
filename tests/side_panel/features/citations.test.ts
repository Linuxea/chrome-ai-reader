import { vi, describe, it, expect, beforeEach } from 'vitest';

const { tabState } = vi.hoisted(() => ({ tabState: { pageParagraphs: ['Intro.', 'The cited passage.'] } as Record<string, unknown> }));
vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string, p?: { text?: string }) => `[${k}]${p?.text ?? ''}` }));
vi.mock('../../../src/side_panel/state.js', () => ({ getActiveTabId: () => 7, getStateForTab: () => tabState }));
vi.mock('../../../src/side_panel/ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/platform/messaging.js', () => ({ sendToContentScript: vi.fn() }));

import { jumpToParagraph } from '../../../src/side_panel/features/citations';
import { sendToContentScript } from '../../../src/platform/messaging.js';
import { showToast } from '../../../src/side_panel/ui/toast.js';

beforeEach(() => { vi.clearAllMocks(); tabState.pageUrl = 'https://example.com/a'; tabState.pageParagraphs = ['Intro.', 'The cited passage.']; });

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

  it('seeks the video to a transcript paragraph on YouTube (F3)', async () => {
    tabState.pageUrl = 'https://www.youtube.com/watch?v=abc';
    tabState.pageParagraphs = ['desc', '[1:05] hello there'];
    vi.mocked(sendToContentScript).mockResolvedValueOnce({ ok: true });
    expect(await jumpToParagraph(1)).toBe(true);
    expect(sendToContentScript).toHaveBeenCalledWith(7, { action: 'seekVideo', seconds: 65 });
  });

  it('shows the cited passage on a PDF instead of messaging the viewer (F3)', async () => {
    tabState.pageUrl = 'https://example.com/paper.pdf';
    expect(await jumpToParagraph(1)).toBe(false);
    expect(sendToContentScript).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenLastCalledWith('[citation.quote]The cited passage.', 5000);
  });
});
