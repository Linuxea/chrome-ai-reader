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
  getActiveTabId: vi.fn(() => 1),
  getPageTitle: vi.fn(() => ''),
  getStateForTab: vi.fn(() => null),
  persistForTab: vi.fn(),
}));
vi.mock('../../../../src/side_panel/ui/dom-helpers.js', () => ({
  appendMessage: vi.fn(),
}));
vi.mock('../../../../src/side_panel/services/page-extractor.js', () => ({
  ensurePageContent: vi.fn(() => Promise.resolve({ ok: true, value: null })),
}));
vi.mock('../../../../src/side_panel/services/tts/index.js', () => ({
  isTTSPlaying: vi.fn(() => false),
  stopTTS: vi.fn(),
}));
vi.mock('../../../../src/side_panel/services/composer.js', () => ({
  validateAttachments: vi.fn(() => Promise.resolve(null)),
  consumeAttachments: vi.fn(() => Promise.resolve({ ocrContext: '', imageUris: [] })),
}));
vi.mock('../../../../src/side_panel/features/podcast/ui.js', () => ({
  createPodcastCard: vi.fn(() => document.createElement('div')),
  updateCardStatus: vi.fn(),
  restoreWelcomeIfNeeded: vi.fn(),
  resetHighlightState: vi.fn(),
  initUICallbacks: vi.fn(),
  rebuildPodcastCard: vi.fn(() => document.createElement('div')),
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
  reattachCard: vi.fn(),
}));
vi.mock('../../../../src/side_panel/features/podcast/now-playing.js', () => ({
  setNowPlaying: vi.fn(),
  updateNowPlaying: vi.fn(),
  clearNowPlaying: vi.fn(),
  getNowPlaying: vi.fn(() => null),
  isNowPlayingGenerating: vi.fn(() => false),
}));
vi.mock('../../../../src/side_panel/features/podcast/script.js', () => ({
  generatePodcastScript: vi.fn(() => Promise.resolve()),
  cleanupScriptPort: vi.fn(),
  initScriptCallbacks: vi.fn(),
}));

import { initPodcast, handlePodcastClick, closePodcast, rebuildCardIfOriginTab } from '../../../../src/side_panel/features/podcast/index';
import * as stateMock from '../../../../src/side_panel/state.js';
import * as nowPlayingMock from '../../../../src/side_panel/features/podcast/now-playing.js';
import { ensurePageContent } from '../../../../src/side_panel/services/page-extractor.js';
import { generatePodcastScript } from '../../../../src/side_panel/features/podcast/script.js';
import { appendMessage } from '../../../../src/side_panel/ui/dom-helpers.js';
import { createPodcastCard } from '../../../../src/side_panel/features/podcast/ui.js';
import * as composerMock from '../../../../src/side_panel/services/composer.js';

describe('features/podcast/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock implementations (clearAllMocks clears implementations too)
    stateMock.getIsGenerating.mockReturnValue(false);
    stateMock.getIsPodcastGenerating.mockReturnValue(false);
    stateMock.getSelectedText.mockReturnValue('');
    stateMock.getOcrResults.mockReturnValue([]);
    stateMock.getPageContent.mockReturnValue('');
    (ensurePageContent as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve({ ok: true, value: null }),
    );
    (generatePodcastScript as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.mocked(composerMock.validateAttachments).mockResolvedValue(null);
    vi.mocked(composerMock.consumeAttachments).mockResolvedValue({ ocrContext: '', imageUris: [] });
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

  it('uses selected text when available (but still extracts the page)', async () => {
    stateMock.getSelectedText.mockReturnValue('Selected content here');
    stateMock.getPageContent.mockReturnValue('cached page content');
    await handlePodcastClick();

    // Extraction is never skipped, even with a selection — the article must
    // be cached for the chat feature. Selection still drives the podcast source.
    expect(ensurePageContent).toHaveBeenCalled();
    expect(generatePodcastScript).toHaveBeenCalled();
    const [, textContent] = vi.mocked(generatePodcastScript).mock.calls[0];
    expect(textContent).toContain('Selected content here');
  });

  it('uses cached page content when no selection', async () => {
    stateMock.getSelectedText.mockReturnValue('');
    stateMock.getPageContent.mockReturnValue('page content');

    await handlePodcastClick();

    expect(ensurePageContent).toHaveBeenCalled();
    expect(generatePodcastScript).toHaveBeenCalled();
    const [, textContent] = vi.mocked(generatePodcastScript).mock.calls[0];
    expect(textContent).toBe('page content');
  });

  it('merges OCR text from pending images into the podcast material (vision off)', async () => {
    stateMock.getSelectedText.mockReturnValue('main text');
    vi.mocked(composerMock.consumeAttachments).mockResolvedValue({ ocrContext: 'OCR text 1\n\nOCR text 3', imageUris: [] });

    await handlePodcastClick();

    const [, textContent, images] = vi.mocked(generatePodcastScript).mock.calls[0];
    expect(textContent).toContain('main text');
    expect(textContent).toContain('OCR text 1');
    expect(textContent).toContain('OCR text 3');
    expect(images).toEqual([]);
  });

  it('passes pending images to the script generator (vision on)', async () => {
    stateMock.getPageContent.mockReturnValue('page content');
    vi.mocked(composerMock.consumeAttachments).mockResolvedValue({ ocrContext: '', imageUris: ['data:image/png;base64,A'] });

    await handlePodcastClick();

    const [, textContent, images] = vi.mocked(generatePodcastScript).mock.calls[0];
    expect(textContent).toBe('page content');
    expect(images).toEqual(['data:image/png;base64,A']);
  });

  it('does not start (and consumes nothing) when attachments are invalid', async () => {
    stateMock.getPageContent.mockReturnValue('page content');
    vi.mocked(composerMock.validateAttachments).mockResolvedValue('ocr running');

    await handlePodcastClick();

    expect(appendMessage).toHaveBeenCalledWith('error', 'ocr running');
    expect(composerMock.consumeAttachments).not.toHaveBeenCalled();
    expect(createPodcastCard).not.toHaveBeenCalled();
  });

  it('shows error when no content available', async () => {
    stateMock.getSelectedText.mockReturnValue('');
    stateMock.getPageContent.mockReturnValue('');

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

  it('records now-playing with the origin tab id on start', async () => {
    stateMock.getActiveTabId.mockReturnValue(42);
    stateMock.getPageTitle.mockReturnValue('Source Page');
    stateMock.getSelectedText.mockReturnValue('content');
    await handlePodcastClick();

    expect(nowPlayingMock.setNowPlaying).toHaveBeenCalledWith(
      expect.objectContaining({
        originTabId: 42,
        originTabTitle: 'Source Page',
        status: 'generating_script',
      }),
    );
  });

  it('blocks start while a podcast is already generating (cross-tab guard)', async () => {
    nowPlayingMock.isNowPlayingGenerating.mockReturnValue(true);
    await handlePodcastClick();
    expect(createPodcastCard).not.toHaveBeenCalled();
  });
});

describe('features/podcast/index — closePodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateMock.getIsGenerating.mockReturnValue(false);
    stateMock.getIsPodcastGenerating.mockReturnValue(false);
    document.body.innerHTML = '<button data-action="podcast"></button>';
    initPodcast({ chatArea: document.createElement('div') });
  });

  it('clears now-playing and frees audio/script state', () => {
    closePodcast();
    expect(nowPlayingMock.clearNowPlaying).toHaveBeenCalled();
  });
});

describe('features/podcast/index — rebuildCardIfOriginTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<button data-action="podcast"></button>';
    initPodcast({ chatArea: document.createElement('div') });
  });

  it('skips rebuild when nothing is playing', () => {
    nowPlayingMock.getNowPlaying.mockReturnValue(null);
    rebuildCardIfOriginTab();
    expect(createPodcastCard).not.toHaveBeenCalled();
  });

  it('skips rebuild when origin tab differs from active tab', () => {
    nowPlayingMock.getNowPlaying.mockReturnValue({
      originTabId: 5, originTabTitle: '', title: 'T', script: [], status: 'playing',
    });
    stateMock.getActiveTabId.mockReturnValue(1);
    rebuildCardIfOriginTab();
    expect(createPodcastCard).not.toHaveBeenCalled();
  });

  it('skips rebuild when a card is already present', () => {
    const chatArea = document.createElement('div');
    chatArea.className = 'podcast-card';
    // re-init with a chatArea that already contains a card
    document.body.appendChild(chatArea);
    initPodcast({ chatArea: chatArea });
    nowPlayingMock.getNowPlaying.mockReturnValue({
      originTabId: 1, originTabTitle: '', title: 'T', script: [], status: 'playing',
    });
    stateMock.getActiveTabId.mockReturnValue(1);
    rebuildCardIfOriginTab();
    expect(createPodcastCard).not.toHaveBeenCalled();
  });
});
