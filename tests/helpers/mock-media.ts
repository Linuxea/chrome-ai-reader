/**
 * Shared MediaSource / SourceBuffer / Audio mocks for Vitest tests.
 *
 * Why this exists: jsdom does NOT implement MediaSource, SourceBuffer, or
 * Audio. Both `tests/services/tts/player.test.js` and
 * `tests/shared/audio-stream.test.js` define their own copies of these mocks.
 * This module deduplicates them into a single, richer implementation.
 *
 * Usage:
 *   import { installMediaMocks, mockAudioInstances, mockMediaSourceInstances } from '../helpers/mock-media';
 *
 *   beforeEach(() => {
 *     mockAudioInstances.length = 0;
 *     mockMediaSourceInstances.length = 0;
 *     installMediaMocks();
 *   });
 *
 * Instances are tracked in the exported arrays so tests can interact with
 * them (e.g. trigger sourceopen, dispatch audio events).
 */

// Track all created instances for test inspection
export const mockAudioInstances: MockAudio[] = [];
export const mockMediaSourceInstances: MockMediaSource[] = [];

export class MockSourceBuffer {
  appendBuffer = vi.fn();
  removeEventListener = vi.fn();
  buffered = { length: 0, end: vi.fn(() => 0) };

  private updateendCb: (() => void) | null = null;
  private errorCb: (() => void) | null = null;

  addEventListener(event: string, cb: (() => void)) {
    if (event === 'updateend') this.updateendCb = cb;
    if (event === 'error') this.errorCb = cb;
  }

  /** Test-only: simulate the async updateend event after appendBuffer completes */
  triggerUpdateend() {
    this.updateendCb?.();
  }

  /** Test-only: simulate a SourceBuffer error */
  triggerError() {
    this.errorCb?.();
  }
}

export class MockMediaSource {
  readyState = 'open';
  sourceBuffers: MockSourceBuffer[] = [];
  endOfStream = vi.fn();
  private listeners: Record<string, (() => void)[]> = {};

  addSourceBuffer() {
    const sb = new MockSourceBuffer();
    this.sourceBuffers.push(sb);
    return sb;
  }

  addEventListener(event: string, cb: (() => void)) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  removeEventListener(event: string, cb: (() => void)) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(f => f !== cb);
    }
  }

  /** Test-only: simulate the sourceopen event that triggers MediaSource setup */
  _simulateSourceOpen() {
    this.listeners['sourceopen']?.forEach(fn => fn());
  }
}

export class MockAudio {
  src = '';
  paused = true;
  ended = false;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  addEventListener(event: string, fn: (...args: unknown[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event: string, fn: (...args: unknown[]) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }
  }

  /** Test-only: dispatch an event to all registered listeners */
  _dispatch(event: string, ...args: unknown[]) {
    this.listeners[event]?.forEach(fn => fn(...args));
  }
}

// Store originals for restoration
let _originals: {
  Audio?: typeof Audio;
  MediaSource?: typeof MediaSource;
  createObjectURL?: typeof URL.createObjectURL;
} | null = null;

/** Install MediaSource, Audio, and URL.createObjectURL mocks on globalThis */
export function installMediaMocks() {
  if (!_originals) {
    _originals = {};
    _originals.Audio = globalThis.Audio;
    _originals.MediaSource = globalThis.MediaSource;
    _originals.createObjectURL = globalThis.URL.createObjectURL;
  }

  // TrackedAudio/TrackedMediaSource wrap the classes to push instances on construction
  const TrackedAudio = function (this: unknown, ..._args: unknown[]) {
    const inst = new MockAudio();
    mockAudioInstances.push(inst);
    return inst;
  } as unknown as typeof Audio;
  TrackedAudio.prototype = MockAudio.prototype;

  const TrackedMediaSource = function (this: unknown, ..._args: unknown[]) {
    const inst = new MockMediaSource();
    mockMediaSourceInstances.push(inst);
    return inst;
  } as unknown as typeof MediaSource;
  TrackedMediaSource.prototype = MockMediaSource.prototype;

  globalThis.Audio = TrackedAudio;
  globalThis.MediaSource = TrackedMediaSource;
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
}

/** Restore original constructors */
export function restoreMediaMocks() {
  if (!_originals) return;
  if (_originals.Audio) globalThis.Audio = _originals.Audio;
  if (_originals.MediaSource) globalThis.MediaSource = _originals.MediaSource;
  if (_originals.createObjectURL) globalThis.URL.createObjectURL = _originals.createObjectURL;
}
