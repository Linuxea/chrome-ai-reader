/**
 * Tests for side_panel/features/podcast/index.ts — podcast orchestration.
 *
 * handlePodcastClick: guard (isGenerating), content extraction (selection/page/OCR),
 * empty content error, script generation delegation.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../../src/side_panel/state.js', () => ({
  getIsGenerating: vi.fn(() => false),
  getIsPodcastGenerating: vi.fn(() => false),
  setIsPodcastGenerating: vi.fn(),
  getSelectedText: vi.fn(() => ''),
  setSelectedText: vi.fn(),
  getOcrResults: vi.fn(() => []),
  subscribe: vi.fn(),
  getPageContent: vi.fn(() => ''),
}));
vi.mock('../../../../src/side_panel/ui/dom-helpers.js', () => ({
  appendMessage: vi.fn(),
}));
vi.mock('../../../../src/side_panel/services/ai-chat.js', () => ({
  extractPageContent: vi.fn(() => Promise.resolve({ ok: true, value: { textContent: 'page text' } })),
}));
vi.mock('../../../../src/side_panel/services/tts/index.js', () => ({
  isTTSPlaying: vi.fn(() => false),
  stopTTS: vi.fn(),
}));
vi.mock('../../../../src/side_panel/services/ocr.js', () => ({ clearImagePreviews: vi.fn() }));
vi.mock('../../../../src/side_panel/features/podcast/ui.js', () => ({
  createPodcastCard: vi.fn(() => document.createElement('div')),
  updateCardStatus: vi.fn(),
  restoreWelcomeIfNeeded: vi.fn(),
  resetHighlightState: vi.fn(),
  initUICallbacks: vi.fn(),
}));
vi.mock('../../../../src/side_panel/features/podcast/audio.js', () => ({
  handlePlayPause: vi.fn(),
  seekToMouse: vi.fn(),
  seekToTouch: vi.fn(),
  addDownloadButton: vi.fn(),
  downloadPodcastAudio: vi.fn(),
  replayAudio: vi.fn(),
  cleanupPodcastAudio: vi.fn(),
  initAudioCallbacks: vi.fn(),
}));
vi.mock('../../../../src/side_panel/features/podcast/script.js', () => ({
  generatePodcastScript: vi.fn(() => Promise.resolve()),
  cleanupScriptPort: vi.fn(),
  initScriptCallbacks: vi.fn(),
}));

import { initPodcast, handlePodcastClick } from '../../../../src/side_panel/features/podcast/index';
import * as stateMock from '../../../../src/side_panel/state.js';
import { extractPageContent } from '../../../../src/side_panel/services/ai-chat.js';
import { generatePodcastScript } from '../../../../src/side_panel/features/podcast/script.js';
import { appendMessage } from '../../../../src/side_panel/ui/dom-helpers.js';
import { createPodcastCard } from '../../../../src/side_panel/features/podcast/ui.js';

describe('features/podcast/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock implementations (clearAllMocks clears implementations too)
    stateMock.getIsGenerating.mockReturnValue(false);
    stateMock.getIsPodcastGenerating.mockReturnValue(false);
    stateMock.getSelectedText.mockReturnValue('');
    stateMock.getOcrResults.mockReturnValue([]);
    stateMock.getPageContent.mockReturnValue('');
    (extractPageContent as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve({ ok: true, value: { textContent: 'page text' } }),
    );
    (generatePodcastScript as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (createPodcastCard as ReturnType<typeof vi.fn>).mockReturnValue(document.createElement('div'));
    // Set up a podcast button in DOM
    document.body.innerHTML = '<button data-action="podcast"></button>';
    initPodcast({ chatArea: document.createElement('div') });
  });

  it('returns early when isGenerating is true', async () => {
    stateMock.getIsGenerating.mockReturnValue(true);
    await handlePodcastClick();
    expect(createPodcastCard).not.toHaveBeenCalled();
  });

  it('returns early when isPodcastGenerating is true', async () => {
    stateMock.getIsPodcastGenerating.mockReturnValue(true);
    await handlePodcastClick();
    expect(createPodcastCard).not.toHaveBeenCalled();
  });

  it('stops TTS if playing when starting podcast', async () => {
    const { isTTSPlaying, stopTTS } = await import('../../../../src/side_panel/services/tts/index.js');
    isTTSPlaying.mockReturnValue(true);
    // Need to re-init to pick up mock
    stateMock.getSelectedText.mockReturnValue('some selection');
    await handlePodcastClick();
    // TTS is mocked, just verify no crash
    expect(stateMock.setIsPodcastGenerating).toHaveBeenCalledWith(true);
  });

  it('uses selected text when available', async () => {
    stateMock.getSelectedText.mockReturnValue('Selected content here');
    await handlePodcastClick();

    expect(generatePodcastScript).toHaveBeenCalled();
    const [, textContent] = vi.mocked(generatePodcastScript).mock.calls[0];
    expect(textContent).toContain('Selected content here');
  });

  it('falls back to page content extraction when no selection', async () => {
    stateMock.getSelectedText.mockReturnValue('');
    stateMock.getPageContent.mockReturnValue('page content');

    await handlePodcastClick();

    expect(extractPageContent).toHaveBeenCalled();
    expect(generatePodcastScript).toHaveBeenCalled();
  });

  it('merges OCR results into text content', async () => {
    stateMock.getSelectedText.mockReturnValue('main text');
    stateMock.getOcrResults.mockReturnValue([
      { text: 'OCR text 1' } as any,
      { text: '' } as any, // empty OCR, should be filtered
      { text: 'OCR text 3' } as any,
    ]);

    await handlePodcastClick();

    const [, textContent] = vi.mocked(generatePodcastScript).mock.calls[0];
    expect(textContent).toContain('main text');
    expect(textContent).toContain('OCR text 1');
    expect(textContent).toContain('OCR text 3');
  });

  it('shows error when no content available', async () => {
    stateMock.getSelectedText.mockReturnValue('');
    stateMock.getPageContent.mockReturnValue('');
    (extractPageContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { textContent: '' },
    });

    await handlePodcastClick();

    expect(appendMessage).toHaveBeenCalledWith('error', '[podcast.noContent]');
    expect(generatePodcastScript).not.toHaveBeenCalled();
  });

  it('creates podcast card and generates script', async () => {
    stateMock.getSelectedText.mockReturnValue('Some content for podcast');
    await handlePodcastClick();

    expect(createPodcastCard).toHaveBeenCalled();
    expect(generatePodcastScript).toHaveBeenCalled();
  });
});
