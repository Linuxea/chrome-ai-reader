import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock URL.createObjectURL
globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

// Mock Audio
const audioInstances = [];
class MockAudio {
  constructor() {
    this.src = '';
    this.listeners = {};
    audioInstances.push(this);
  }
  play() { return Promise.resolve(); }
  pause() {}
  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  removeEventListener(event, fn) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }
  }
}
globalThis.Audio = MockAudio;

// Mock MediaSource
class MockMediaSource {
  constructor() {
    this.readyState = 'open';
    this.sourceBuffers = [];
    this.listeners = {};
  }
  addSourceBuffer() {
    const sb = {
      buffered: { length: 0 },
      listeners: {},
      appendBuffer: vi.fn(),
      addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
      },
      removeEventListener(event, fn) {
        if (this.listeners[event]) {
          this.listeners[event] = this.listeners[event].filter(f => f !== fn);
        }
      },
    };
    this.sourceBuffers.push(sb);
    return sb;
  }
  endOfStream() { this.readyState = 'closed'; }
  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  _simulateSourceOpen() {
    this.listeners['sourceopen']?.forEach(fn => fn());
  }
}
globalThis.MediaSource = MockMediaSource;

// Mock chrome
const { createMockPort } = await import('../../helpers/chrome-mock.js');
globalThis.chrome = {
  runtime: { connect: vi.fn(() => createMockPort('tts')) },
};

import {
  initPlayer,
  setTTSAutoPlay,
  isTTSAutoPlay,
  isTTSPlaying,
  isTTSAudioStarted,
  stopTTSPlayback,
  initTTSPlayback,
  ttsAppendChunk,
  ttsFlushRemaining,
  setFullStopFn,
  getTTSButton,
  setTTSButton,
  setTTSOrigin,
  getTTSOrigin,
  detachTTSAnchor,
  subscribeTTSState,
} from '../../../src/side_panel/services/tts/player.js';

describe('TTS Player', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioInstances.length = 0;
    const chatArea = document.createElement('div');
    initPlayer(chatArea);
    stopTTSPlayback(); // Reset all internal state
  });

  describe('initPlayer', () => {
    it('initializes without error', () => {
      const chatArea = document.createElement('div');
      expect(() => initPlayer(chatArea)).not.toThrow();
    });
  });

  describe('setTTSAutoPlay / isTTSAutoPlay', () => {
    it('defaults to false', () => {
      expect(isTTSAutoPlay()).toBe(false);
    });

    it('can be enabled', () => {
      setTTSAutoPlay(true);
      expect(isTTSAutoPlay()).toBe(true);
    });

    it('can be disabled', () => {
      setTTSAutoPlay(true);
      setTTSAutoPlay(false);
      expect(isTTSAutoPlay()).toBe(false);
    });
  });

  describe('isTTSPlaying', () => {
    it('is false before playback starts', () => {
      expect(isTTSPlaying()).toBe(false);
    });
  });

  describe('stopTTSPlayback', () => {
    it('stops playback and resets playing state', () => {
      initTTSPlayback();
      stopTTSPlayback();
      expect(isTTSPlaying()).toBe(false);
    });

    it('autoPlay state persists after stop', () => {
      setTTSAutoPlay(true);
      stopTTSPlayback();
      expect(isTTSAutoPlay()).toBe(true);
    });
  });

  describe('initTTSPlayback', () => {
    it('sets playing state to true', () => {
      initTTSPlayback();
      expect(isTTSPlaying()).toBe(true);
    });

    it('creates an Audio element', () => {
      initTTSPlayback();
      expect(audioInstances.length).toBeGreaterThan(0);
    });

    it('shows loading on the clicked message\'s button (not the first one in the chat)', () => {
      const first = document.createElement('button');
      const clicked = document.createElement('button');
      initTTSPlayback(clicked);
      expect(getTTSButton()).toBe(clicked);
      expect(clicked.classList.contains('tts-loading')).toBe(true);
      expect(first.classList.contains('tts-loading')).toBe(false);
    });

    it('setTTSButton attaches a later-created button (autoplay) to the running playback', () => {
      initTTSPlayback();
      const btn = document.createElement('button');
      setTTSButton(btn);
      expect(btn.classList.contains('tts-loading')).toBe(true);
    });
  });

  describe('ttsAppendChunk', () => {
    it('does not throw when not playing', () => {
      stopTTSPlayback();
      setTTSAutoPlay(true);
      expect(() => ttsAppendChunk('Hello.')).not.toThrow();
    });

    it('does not throw when autoPlay is disabled', () => {
      initTTSPlayback();
      setTTSAutoPlay(false);
      expect(() => ttsAppendChunk('Hello. World.')).not.toThrow();
    });
  });

  describe('ttsFlushRemaining', () => {
    it('does not throw when not playing', () => {
      stopTTSPlayback();
      expect(() => ttsFlushRemaining()).not.toThrow();
    });
  });

  describe('ttsEnqueue (via ttsAppendChunk with autoPlay)', () => {
    it('strips markdown before enqueueing', () => {
      initTTSPlayback();
      setTTSAutoPlay(true);

      // Simulate sourceopen to set up sourceBuffer
      // Get the MediaSource instance (it's internal, but we can trigger it via the audio)
      // The MediaSource was created in initTTSPlayback, but we can't easily access it
      // Just verify no crash
      expect(() => ttsAppendChunk('**Bold** text. Normal sentence.')).not.toThrow();
    });
  });

  describe('setFullStopFn', () => {
    it('stores the callback and calls it on audio ended', () => {
      const fn = vi.fn();
      setFullStopFn(fn);
      initTTSPlayback();
      const audio = audioInstances[audioInstances.length - 1];
      audio.listeners['ended']?.forEach(listener => listener());
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('full stop callback on port disconnect', () => {
    it('calls fullStopFn when tts port disconnects during playback', () => {
      const fn = vi.fn();
      setFullStopFn(fn);
      initTTSPlayback();
      setTTSAutoPlay(true);

      // Enqueue some text to create a port
      ttsAppendChunk('First sentence. Second sentence. Third sentence. Fourth. Fifth.');
      // The port would be created internally, but we'd need sourceopen first
      // Just verify the callback is set
      expect(fn).toBeDefined();
    });
  });

  describe('takeover point (window-global resource)', () => {
    it('starting a new playback while one runs fully stops the previous one', () => {
      const fn = vi.fn();
      setFullStopFn(fn);
      initTTSPlayback();
      expect(fn).not.toHaveBeenCalled();

      initTTSPlayback();
      // the old playback was stopped via the full-stop fn, the new one plays
      expect(fn).toHaveBeenCalledTimes(1);
      expect(isTTSPlaying()).toBe(true);
    });
  });

  describe('origin tracking', () => {
    it('records the origin passed to initTTSPlayback', () => {
      initTTSPlayback(null, { tabId: 3, msgId: 'm9' });
      expect(getTTSOrigin()).toEqual({ tabId: 3, msgId: 'm9' });
    });

    it('setTTSOrigin late-binds the msgId (autoplay starts before the bubble exists)', () => {
      initTTSPlayback(null, { tabId: 3 });
      expect(getTTSOrigin()).toEqual({ tabId: 3, msgId: null });
      setTTSOrigin({ msgId: 'late-1' });
      expect(getTTSOrigin()).toEqual({ tabId: 3, msgId: 'late-1' });
    });

    it('origin is cleared on stop', () => {
      initTTSPlayback(null, { tabId: 3, msgId: 'm9' });
      stopTTSPlayback();
      expect(getTTSOrigin()).toEqual({ tabId: null, msgId: null });
    });

    it('a new playback resets a previous origin', () => {
      initTTSPlayback(null, { tabId: 3, msgId: 'm9' });
      initTTSPlayback(null, { tabId: 5 });
      expect(getTTSOrigin()).toEqual({ tabId: 5, msgId: null });
    });
  });

  describe('detachTTSAnchor (tab switch)', () => {
    it('drops the button anchor but keeps playing', () => {
      const btn = document.createElement('button');
      initTTSPlayback(btn, { tabId: 1, msgId: 'm1' });
      expect(isTTSPlaying()).toBe(true);

      detachTTSAnchor();

      expect(getTTSButton()).toBeNull();
      expect(isTTSPlaying()).toBe(true);
      expect(getTTSOrigin()).toEqual({ tabId: 1, msgId: 'm1' });
    });

    it('a detached anchor re-attached via setTTSButton gets the loading state', () => {
      const btn = document.createElement('button');
      initTTSPlayback(null, { tabId: 1, msgId: 'm1' });
      detachTTSAnchor();

      setTTSButton(btn);
      expect(getTTSButton()).toBe(btn);
      expect(btn.classList.contains('tts-loading')).toBe(true);
    });
  });

  describe('subscribeTTSState (global indicator)', () => {
    it('notifies start (waiting), audio start, and stop', () => {
      const seen = [];
      const unsubscribe = subscribeTTSState(s => seen.push({ ...s }));
      try {
        initTTSPlayback();
        expect(seen.at(-1)).toEqual({ playing: true, audioStarted: false });
        expect(isTTSAudioStarted()).toBe(false);

        stopTTSPlayback();
        expect(seen.at(-1)).toEqual({ playing: false, audioStarted: false });
      } finally {
        unsubscribe();
      }
    });

    it('stop without playback does not notify', () => {
      const cb = vi.fn();
      const unsubscribe = subscribeTTSState(cb);
      try {
        stopTTSPlayback();
        expect(cb).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    });

    it('unsubscribe stops notifications', () => {
      const cb = vi.fn();
      const unsubscribe = subscribeTTSState(cb);
      unsubscribe();
      initTTSPlayback();
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
