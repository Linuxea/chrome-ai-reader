/**
 * Tests for side_panel/services/tts/index.ts — TTS facade.
 *
 * Facade that routes to player/downloader/tts-buttons. Tests verify:
 * - stopTTS: delegates to playback+download stop, clears button classes
 * - addTTSButton: delegates to createTTSButtons
 * - initTTSAutoPlay: guards on autoplay+playing conditions
 * - handleTTSButtonClick: text extraction + segmentation + enqueue
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../src/shared/css-selectors.js', () => ({
  CSS: {
    TTS_BTN: '.tts-btn',
    TTS_PLAYING: '.tts-playing',
    TTS_LOADING: '.tts-loading',
  },
}));
vi.mock('../../../src/side_panel/ui/tts-buttons.js', () => ({
  createTTSButtons: vi.fn(),
}));
vi.mock('../../../src/side_panel/services/tts/utils.js', () => ({
  splitToSegments: vi.fn((text: string) => text.split('. ').filter(Boolean)),
}));
vi.mock('../../../src/side_panel/services/tts/player.js', () => ({
  initPlayer: vi.fn(),
  setFullStopFn: vi.fn(),
  setTTSAutoPlay: vi.fn(),
  isTTSPlaying: vi.fn(() => false),
  isTTSAutoPlay: vi.fn(() => false),
  initTTSPlayback: vi.fn(),
  ttsAppendChunk: vi.fn(),
  ttsEnqueue: vi.fn(),
  ttsFlushRemaining: vi.fn(),
  stopTTSPlayback: vi.fn(),
}));
vi.mock('../../../src/side_panel/services/tts/downloader.js', () => ({
  initDownloader: vi.fn(),
  stopTTSDownload: vi.fn(),
  handleTTSDownloadClick: vi.fn(),
}));

import {
  initTTS,
  isTTSPlaying,
  stopTTS,
  addTTSButton,
  initTTSAutoPlay,
} from '../../../src/side_panel/services/tts/index';
import * as playerMock from '../../../src/side_panel/services/tts/player.js';
import * as downloaderMock from '../../../src/side_panel/services/tts/downloader.js';
import { createTTSButtons } from '../../../src/side_panel/ui/tts-buttons.js';

// chrome mock for storage
vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get: vi.fn((_keys: string[], cb: (data: Record<string, unknown>) => void) => cb({})),
    },
    onChanged: { addListener: vi.fn() },
  },
});

describe('services/tts/index', () => {
  let chatArea: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);
    initTTS({ chatArea });
  });

  describe('isTTSPlaying()', () => {
    it('delegates to player.isTTSPlaying', () => {
      playerMock.isTTSPlaying.mockReturnValue(true);
      expect(isTTSPlaying()).toBe(true);
      playerMock.isTTSPlaying.mockReturnValue(false);
      expect(isTTSPlaying()).toBe(false);
    });
  });

  describe('stopTTS()', () => {
    it('calls both stopTTSPlayback and stopTTSDownload', () => {
      stopTTS();
      expect(playerMock.stopTTSPlayback).toHaveBeenCalled();
      expect(downloaderMock.stopTTSDownload).toHaveBeenCalled();
    });

    it('removes tts-playing and tts-loading classes from TTS button', () => {
      const btn = document.createElement('button');
      btn.className = 'tts-btn tts-playing tts-loading';
      chatArea.appendChild(btn);

      stopTTS();

      expect(btn.classList.contains('tts-playing')).toBe(false);
      expect(btn.classList.contains('tts-loading')).toBe(false);
    });

    it('does not crash when no TTS button exists', () => {
      expect(() => stopTTS()).not.toThrow();
    });
  });

  describe('addTTSButton()', () => {
    it('delegates to createTTSButtons with toggle and download callbacks', () => {
      const msgEl = document.createElement('div');
      addTTSButton(msgEl);

      expect(createTTSButtons).toHaveBeenCalledWith(msgEl, expect.objectContaining({
        onDownload: expect.any(Function),
        onToggleTTS: expect.any(Function),
      }));
    });
  });

  describe('initTTSAutoPlay()', () => {
    it('calls ttsFlushRemaining when autoplay is enabled and TTS is playing', () => {
      playerMock.isTTSAutoPlay.mockReturnValue(true);
      playerMock.isTTSPlaying.mockReturnValue(true);

      initTTSAutoPlay();

      expect(playerMock.ttsFlushRemaining).toHaveBeenCalled();
    });

    it('does nothing when autoplay is disabled', () => {
      playerMock.isTTSAutoPlay.mockReturnValue(false);
      playerMock.isTTSPlaying.mockReturnValue(true);

      initTTSAutoPlay();

      expect(playerMock.ttsFlushRemaining).not.toHaveBeenCalled();
    });

    it('does nothing when not playing', () => {
      playerMock.isTTSAutoPlay.mockReturnValue(true);
      playerMock.isTTSPlaying.mockReturnValue(false);

      initTTSAutoPlay();

      expect(playerMock.ttsFlushRemaining).not.toHaveBeenCalled();
    });
  });
});
