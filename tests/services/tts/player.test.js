import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock chrome.runtime.connect with programmable port
const { createMockPort } = await import('../../helpers/chrome-mock.js');
globalThis.chrome = {
  runtime: { connect: vi.fn(() => createMockPort('tts')) },
};

// Mock AudioContext + BufferSource (the WebAudio sink)
const ctxInstances = [];
const sources = [];
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = { __destination: true };
    this.resume = vi.fn(() => Promise.resolve());
    this.close = vi.fn(() => Promise.resolve());
    ctxInstances.push(this);
  }
  // deterministic duration: 8 KB of mp3 == 1 s of audio
  async decodeAudioData(buf) { return { duration: buf.byteLength / 8000 }; }
  createBufferSource() {
    const src = {
      buffer: null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    sources.push(src);
    return src;
  }
}
globalThis.AudioContext = MockAudioContext;

import {
  initPlayer,
  setTTSAutoPlay,
  isTTSAutoPlay,
  isTTSPlaying,
  isTTSAudioStarted,
  stopTTSPlayback,
  initTTSPlayback,
  ttsAppendChunk,
  ttsEnqueue,
  ttsFlushRemaining,
  ttsFinishInput,
  setFullStopFn,
  getTTSButton,
  setTTSButton,
  setTTSOrigin,
  getTTSOrigin,
  detachTTSAnchor,
  subscribeTTSState,
  setTTSPlaybackRate,
  getTTSPlaybackRate,
  currentProgress,
} from '../../../src/side_panel/services/tts/player.js';

const b64 = (s) => btoa(s);

describe('TTS Player', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctxInstances.length = 0;
    sources.length = 0;
    stopTTSPlayback(); // Reset all internal state — BEFORE the rate reset (a
    // running playback + rate touch would reschedule sources into this test)
    setTTSPlaybackRate(1);
    const chatArea = document.createElement('div');
    initPlayer(chatArea);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('initPlayer', () => {
    it('initializes without error', () => {
      const chatArea = document.createElement('div');
      expect(() => initPlayer(chatArea)).not.toThrow();
    });
  });

  describe('setTTSAutoPlay / isTTSAutoPlay', () => {
    it('defaults to false and can be toggled', () => {
      expect(isTTSAutoPlay()).toBe(false);
      setTTSAutoPlay(true);
      expect(isTTSAutoPlay()).toBe(true);
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
    it('sets playing state (waiting for the first segment)', () => {
      initTTSPlayback();
      expect(isTTSPlaying()).toBe(true);
      expect(isTTSAudioStarted()).toBe(false);
    });

    it('creates no AudioContext until a segment actually arrives', () => {
      initTTSPlayback();
      expect(ctxInstances.length).toBe(0);
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

  /** Enqueue segments, finish input, and drive every engine port to done. */
  async function deliverSegments(texts, byteSeconds = 1) {
    for (const text of texts) ttsEnqueue(text);
    ttsFinishInput();
    await vi.waitFor(() => expect(chrome.runtime.connect.mock.calls.length).toBe(texts.length));
    const ports = chrome.runtime.connect.mock.results.slice(-texts.length).map((r) => r.value);
    ports.forEach((port, i) => {
      port._simulateMessage({ type: 'chunk', data: b64('x'.repeat(8000 * (byteSeconds[i] ?? byteSeconds))) });
      port._simulateMessage({ type: 'done' });
    });
    await vi.waitFor(() => {
      expect(sources.filter((s) => s.start.mock.calls.length > 0).length).toBe(texts.length);
    });
    return ports;
  }

  describe('WebAudio scheduling', () => {
    it('connects every source to the context destination (unconnected = silence)', async () => {
      initTTSPlayback();
      await deliverSegments(['seg one', 'seg two'], [1, 2]);
      const ctx = ctxInstances[0];
      for (const src of sources) {
        expect(src.connect).toHaveBeenCalledWith(ctx.destination);
      }
    });

    it('decodes each segment independently and schedules it back-to-back', async () => {
      initTTSPlayback();
      await deliverSegments(['seg one', 'seg two'], [1, 2]);

      expect(sources.filter((s) => s.start.mock.calls.length > 0).length).toBe(2);
      expect(isTTSAudioStarted()).toBe(true);
      // total scheduled audio: 1s + 2s
      expect(currentProgress()).toEqual({ position: 0, end: 3 });
    });

    it('finishes playback (full stop) once everything played out', async () => {
      const fullStop = vi.fn();
      setFullStopFn(fullStop);
      initTTSPlayback();
      await deliverSegments(['only'], [1]);
      expect(fullStop).not.toHaveBeenCalled();

      const ctx = ctxInstances[0];
      ctx.currentTime = 10; // playhead past the end
      for (const s of [...sources]) s.onended?.();
      await vi.waitFor(() => expect(fullStop).toHaveBeenCalled());
    });

    it('rate change stops live sources and reschedules the unplayed remainder', async () => {
      initTTSPlayback();
      await deliverSegments(['one', 'two'], [1, 1]);

      const ctx = ctxInstances[0];
      ctx.currentTime = 0.5; // ~0.44s into segment 1 (anchor at 0.06)
      setTTSPlaybackRate(2);

      expect(sources.length).toBe(4); // 2 original + 2 rescheduled
      const [seg1Again, seg2Again] = sources.slice(2);
      expect(seg1Again.playbackRate.value).toBe(2);
      expect(seg1Again.start.mock.calls[0][1]).toBeCloseTo(0.44, 1); // resumed mid-buffer
      expect(seg2Again.playbackRate.value).toBe(2);
      expect(seg2Again.start.mock.calls[0][1]).toBe(0); // not started yet
      expect(getTTSPlaybackRate()).toBe(2);
    });

    it('a decode failure skips the segment instead of killing playback', async () => {
      initTTSPlayback();
      ttsEnqueue('bad');
      ttsFinishInput();
      await vi.waitFor(() => expect(chrome.runtime.connect).toHaveBeenCalled());
      const port = chrome.runtime.connect.mock.results.at(-1).value;
      const realDecode = MockAudioContext.prototype.decodeAudioData;
      MockAudioContext.prototype.decodeAudioData = vi.fn(async () => { throw new Error('corrupt'); });
      port._simulateMessage({ type: 'chunk', data: b64('x'.repeat(8000)) });
      port._simulateMessage({ type: 'done' });
      await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
      MockAudioContext.prototype.decodeAudioData = realDecode;
      expect(isTTSPlaying()).toBe(true); // playback survives
    });
  });

  describe('progress (indicator m:ss / m:ss)', () => {
    it('is null before anything is scheduled', () => {
      initTTSPlayback();
      expect(currentProgress()).toBeNull();
    });

    it('clamps the position to the scheduled end', async () => {
      initTTSPlayback();
      await deliverSegments(['one'], [2]);
      const ctx = ctxInstances[0];
      ctx.currentTime = 100; // far past the end
      expect(currentProgress()).toEqual({ position: 2, end: 2 });
    });
  });

  describe('ttsAppendChunk / ttsFlushRemaining', () => {
    it('does not throw when not playing', () => {
      stopTTSPlayback();
      setTTSAutoPlay(true);
      expect(() => ttsAppendChunk('Hello.')).not.toThrow();
      expect(() => ttsFlushRemaining()).not.toThrow();
    });

    it('does not throw when autoPlay is disabled', () => {
      initTTSPlayback();
      setTTSAutoPlay(false);
      expect(() => ttsAppendChunk('Hello. World.')).not.toThrow();
    });
  });

  describe('setFullStopFn', () => {
    it('stores the callback and calls it on playback end', async () => {
      const fn = vi.fn();
      setFullStopFn(fn);
      initTTSPlayback();
      await deliverSegments(['one'], [1]);
      const ctx = ctxInstances[0];
      ctx.currentTime = 10;
      sources.forEach((s) => s.onended?.());
      await vi.waitFor(() => expect(fn).toHaveBeenCalled());
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
    it('notifies start (waiting), audio start, and stop', async () => {
      const seen = [];
      const unsubscribe = subscribeTTSState(s => seen.push({ ...s }));
      try {
        initTTSPlayback();
        expect(seen.at(-1)).toEqual({ playing: true, audioStarted: false });

        await deliverSegments(['one'], [1]);
        expect(seen.some(s => s.playing && s.audioStarted)).toBe(true);

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

  describe('engine wiring (autoplay)', () => {
    it('dispatches a synthesized segment once enough text has streamed in', async () => {
      initTTSPlayback();
      setTTSAutoPlay(true);

      ttsAppendChunk('一。二。三。四。五。六。七。八。九。十。'.repeat(7)); // > FIRST_SEGMENT_CHARS
      await vi.waitFor(() => {
        expect(chrome.runtime.connect).toHaveBeenCalled();
      });

      ttsFlushRemaining(); // answer ended
      expect(() => ttsFinishInput()).not.toThrow();
      stopTTSPlayback();
    });

    it('ttsFinishInput without a playback does not throw', () => {
      stopTTSPlayback();
      expect(() => ttsFinishInput()).not.toThrow();
    });
  });
});
