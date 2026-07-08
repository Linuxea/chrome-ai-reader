/**
 * Tests for side_panel/features/podcast/mini-player.ts — persistent mini-player.
 *
 * Tests: visibility driven by now-playing, title text, play/pause icon,
 * disabled state while generating, close/play button wiring.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../../src/side_panel/features/podcast/audio.js', () => ({
  handlePlayPause: vi.fn(),
  replayAudio: vi.fn(),
  isPodcastAudioPlaying: vi.fn(() => false),
  onPodcastPlayState: vi.fn(() => () => {}),
}));
vi.mock('../../../../src/side_panel/features/podcast/index.js', () => ({
  closePodcast: vi.fn(),
}));

import { initMiniPlayer } from '../../../../src/side_panel/features/podcast/mini-player';
import { setNowPlaying, clearNowPlaying } from '../../../../src/side_panel/features/podcast/now-playing';
import * as audioMock from '../../../../src/side_panel/features/podcast/audio.js';
import { closePodcast } from '../../../../src/side_panel/features/podcast/index.js';

function mountMiniPlayer(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'podcastMiniPlayer';
  root.className = 'podcast-mini hidden';
  root.innerHTML = `
    <span class="podcast-mini-icon"></span>
    <span class="podcast-mini-title"></span>
    <button class="podcast-mini-play-btn" type="button"></button>
    <button class="podcast-mini-close" type="button"></button>
  `;
  document.body.innerHTML = '';
  document.body.appendChild(root);
  return root;
}

const baseNp = {
  originTabId: 1,
  originTabTitle: 'Tab A',
  title: 'Hello World',
  script: [],
  status: 'playing' as const,
};

describe('features/podcast/mini-player', () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    audioMock.isPodcastAudioPlaying.mockReturnValue(false);
    clearNowPlaying();
    root = mountMiniPlayer();
    initMiniPlayer();
  });

  it('is hidden when nothing is playing', () => {
    expect(root.classList.contains('hidden')).toBe(true);
  });

  it('becomes visible when now-playing is set', () => {
    setNowPlaying(baseNp);
    expect(root.classList.contains('hidden')).toBe(false);
  });

  it('hides again when now-playing is cleared', () => {
    setNowPlaying(baseNp);
    clearNowPlaying();
    expect(root.classList.contains('hidden')).toBe(true);
  });

  it('shows the podcast title when not generating', () => {
    setNowPlaying(baseNp);
    const titleEl = root.querySelector('.podcast-mini-title')!;
    expect(titleEl.textContent).toBe('Hello World');
  });

  it('shows the generating label while generating script', () => {
    setNowPlaying({ ...baseNp, title: '', status: 'generating_script' });
    const titleEl = root.querySelector('.podcast-mini-title')!;
    expect(titleEl.textContent).toBe('[podcast.miniGenerating]');
  });

  it('falls back to cardTitle when title is empty but not generating', () => {
    setNowPlaying({ ...baseNp, title: '', status: 'done' });
    const titleEl = root.querySelector('.podcast-mini-title')!;
    expect(titleEl.textContent).toBe('[podcast.cardTitle]');
  });

  describe('play button', () => {
    it('is disabled while generating', () => {
      setNowPlaying({ ...baseNp, status: 'generating_audio' });
      const btn = root.querySelector('.podcast-mini-play-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('is enabled and shows play icon when audio is paused', () => {
      audioMock.isPodcastAudioPlaying.mockReturnValue(false);
      setNowPlaying({ ...baseNp, status: 'playing' });
      const btn = root.querySelector('.podcast-mini-play-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      expect(btn.innerHTML).toContain('polygon');
      expect(btn.title).toBe('[podcast.play]');
    });

    it('shows pause icon when audio is playing', () => {
      audioMock.isPodcastAudioPlaying.mockReturnValue(true);
      setNowPlaying({ ...baseNp, status: 'playing' });
      const btn = root.querySelector('.podcast-mini-play-btn') as HTMLButtonElement;
      expect(btn.innerHTML).toContain('rect');
      expect(btn.title).toBe('[podcast.pause]');
    });

    it('calls handlePlayPause on click when playing', () => {
      setNowPlaying({ ...baseNp, status: 'playing' });
      const btn = root.querySelector('.podcast-mini-play-btn') as HTMLButtonElement;
      btn.click();
      expect(audioMock.handlePlayPause).toHaveBeenCalled();
      expect(audioMock.replayAudio).not.toHaveBeenCalled();
    });

    it('calls replayAudio on click when status is done', () => {
      setNowPlaying({ ...baseNp, status: 'done' });
      const btn = root.querySelector('.podcast-mini-play-btn') as HTMLButtonElement;
      btn.click();
      expect(audioMock.replayAudio).toHaveBeenCalledWith(null);
      expect(audioMock.handlePlayPause).not.toHaveBeenCalled();
    });

    it('does nothing on click while generating', () => {
      setNowPlaying({ ...baseNp, status: 'generating_audio' });
      const btn = root.querySelector('.podcast-mini-play-btn') as HTMLButtonElement;
      btn.click();
      expect(audioMock.handlePlayPause).not.toHaveBeenCalled();
      expect(audioMock.replayAudio).not.toHaveBeenCalled();
    });
  });

  it('close button calls closePodcast', () => {
    setNowPlaying(baseNp);
    const closeBtn = root.querySelector('.podcast-mini-close') as HTMLButtonElement;
    closeBtn.click();
    expect(closePodcast).toHaveBeenCalled();
  });
});
