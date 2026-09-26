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
    TTS_DOWNLOAD_BTN: '.tts-download-btn',
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
  isTTSAudioStarted: vi.fn(() => false),
  initTTSPlayback: vi.fn(),
  ttsAppendChunk: vi.fn(),
  ttsEnqueue: vi.fn(),
  ttsFlushRemaining: vi.fn(),
  stopTTSPlayback: vi.fn(),
  getTTSButton: vi.fn(() => null),
  setTTSButton: vi.fn(),
  setTTSOrigin: vi.fn(),
  getTTSOrigin: vi.fn(() => ({ tabId: null, msgId: null })),
  detachTTSAnchor: vi.fn(),
  subscribeTTSState: vi.fn(() => () => {}),
}));
vi.mock('../../../src/side_panel/services/tts/downloader.js', () => ({
  initDownloader: vi.fn(),
  stopTTSDownload: vi.fn(),
  handleTTSDownloadClick: vi.fn(),
  detachDownloadAnchor: vi.fn(),
  reattachDownloadAnchor: vi.fn(),
  getDownloadOrigin: vi.fn(() => ({ tabId: null, msgId: null })),
  isTTSDownloading: vi.fn(() => false),
}));

import {
  initTTS,
  isTTSPlaying,
  stopTTS,
  detachTTS,
  addTTSButton,
  initTTSAutoPlay,
  initTTSPlayback,
} from '../../../src/side_panel/services/tts/index';
import * as playerMock from '../../../src/side_panel/services/tts/player.js';
import * as downloaderMock from '../../../src/side_panel/services/tts/downloader.js';
import { createTTSButtons } from '../../../src/side_panel/ui/tts-buttons.js';
import { on, EVENTS } from '../../../src/side_panel/events.js';

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
      vi.mocked(playerMock.getTTSButton).mockReturnValueOnce(btn);

      stopTTS();

      expect(btn.classList.contains('tts-playing')).toBe(false);
      expect(btn.classList.contains('tts-loading')).toBe(false);
      expect(playerMock.setTTSButton).toHaveBeenCalledWith(null);
    });

    it('does not crash when no TTS button exists', () => {
      expect(() => stopTTS()).not.toThrow();
    });
  });

  describe('detachTTS()', () => {
    it('detaches both anchors without stopping playback or download', () => {
      detachTTS();
      expect(playerMock.detachTTSAnchor).toHaveBeenCalled();
      expect(playerMock.stopTTSPlayback).not.toHaveBeenCalled();
      expect(downloaderMock.detachDownloadAnchor).toHaveBeenCalled();
      expect(downloaderMock.stopTTSDownload).not.toHaveBeenCalled();
    });
  });

  describe('initTTSPlayback()', () => {
    it('claims the audio resource: emits PODCAST_STOP_REQUEST, then starts the player', () => {
      const handler = vi.fn();
      const unsubscribe = on(EVENTS.PODCAST_STOP_REQUEST, handler);
      try {
        initTTSPlayback({ tabId: 7 });
        expect(handler).toHaveBeenCalledTimes(1);
      } finally {
        unsubscribe();
      }
      expect(playerMock.initTTSPlayback).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ tabId: 7 }),
      );
    });

    it('defaults the origin tab to the active tab', () => {
      initTTSPlayback();
      expect(playerMock.initTTSPlayback).toHaveBeenCalledWith(null, {
        tabId: null, // no active tab in this test context
        msgId: null,
      });
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
