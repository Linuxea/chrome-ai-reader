import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * TTS↔podcast mutual exclusion: emitting PODCAST_STOP_REQUEST (services/tts
 * claiming the single audio resource) stops a playing podcast but keeps its
 * now-playing entry (replay/download stay available); a mid-generation
 * podcast is cancelled entirely.
 */

vi.mock('../../../src/side_panel/features/podcast/audio.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, stopPodcastAudioForTTS: vi.fn() };
});

const { createChromeMock } = await import('../../helpers/chrome-mock.js');
globalThis.chrome = createChromeMock().chrome;

const { stopPodcastAudioForTTS } = await import('../../../src/side_panel/features/podcast/audio.js');
const { initPodcast } = await import('../../../src/side_panel/features/podcast/index.js');
const { setNowPlaying, getNowPlaying, clearNowPlaying } = await import('../../../src/side_panel/features/podcast/now-playing.js');
const { emit, EVENTS } = await import('../../../src/side_panel/events.js');

function nowPlayingWith(status) {
  setNowPlaying({
    originTabId: 1,
    originTabTitle: 'Page',
    title: 'A podcast',
    script: [],
    status,
  });
}

describe('PODCAST_STOP_REQUEST (TTS claims the audio resource)', () => {
  let chatArea;

  beforeEach(() => {
    vi.clearAllMocks();
    clearNowPlaying();
    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);
    initPodcast({ chatArea });
  });

  afterEach(() => {
    clearNowPlaying();
    document.body.innerHTML = '';
  });

  it('stops a playing podcast without clearing now-playing', () => {
    nowPlayingWith('playing');

    emit(EVENTS.PODCAST_STOP_REQUEST);

    expect(stopPodcastAudioForTTS).toHaveBeenCalledTimes(1);
    expect(getNowPlaying()).not.toBeNull(); // replay/download stay available
  });

  it('cancels a mid-generation podcast entirely', () => {
    nowPlayingWith('generating_audio');

    emit(EVENTS.PODCAST_STOP_REQUEST);

    expect(stopPodcastAudioForTTS).not.toHaveBeenCalled();
    expect(getNowPlaying()).toBeNull(); // closePodcast tore it down
  });

  it('does nothing without now-playing state', () => {
    emit(EVENTS.PODCAST_STOP_REQUEST);

    expect(stopPodcastAudioForTTS).not.toHaveBeenCalled();
    expect(getNowPlaying()).toBeNull();
  });
});
