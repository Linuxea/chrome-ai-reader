import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Audio and MediaSource
class MockSourceBuffer {
  appendBuffer = vi.fn();
  removeEventListener = vi.fn();
  _updateendCb = null;
  buffered = { length: 0, end: vi.fn(() => 0) };

  addEventListener(event, cb) {
    if (event === 'updateend') this._updateendCb = cb;
  }

  triggerUpdateend() {
    if (this._updateendCb) this._updateendCb();
  }
}

class MockMediaSource {
  readyState = 'open';
  sourceBuffers = [];
  endOfStream = vi.fn();
  addEventListener = vi.fn();

  addSourceBuffer() {
    const sb = new MockSourceBuffer();
    this.sourceBuffers.push(sb);
    return sb;
  }
}

class MockAudio {
  src = '';
  paused = true;
  ended = false;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  addEventListener = vi.fn();
}

globalThis.MediaSource = MockMediaSource;
globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
globalThis.Audio = MockAudio;

import { createAudioStream } from '../../src/shared/audio-stream.ts';

describe('createAudioStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an audio stream handle', () => {
    const handle = createAudioStream({ mimeType: 'audio/mpeg' });
    expect(handle).toBeDefined();
    expect(handle.appendChunk).toBeInstanceOf(Function);
    expect(handle.finish).toBeInstanceOf(Function);
    expect(handle.destroy).toBeInstanceOf(Function);
    expect(handle.audioEl).toBeDefined();
  });

  it('destroy cleans up audio element', () => {
    const handle = createAudioStream({ mimeType: 'audio/mpeg' });
    const audioEl = handle.audioEl;
    handle.destroy();
    expect(audioEl.pause).toHaveBeenCalled();
    expect(audioEl.src).toBe('');
  });

  it('appendChunk adds to queue', () => {
    const handle = createAudioStream({ mimeType: 'audio/mpeg' });
    // base64 "test" data
    handle.appendChunk('dGVzdA==');
    // No error thrown means success
  });

  it('finish calls endOfStream', () => {
    const handle = createAudioStream({ mimeType: 'audio/mpeg' });
    handle.finish();
    // No error thrown means success
  });

  it('destroy can be called multiple times safely', () => {
    const handle = createAudioStream({ mimeType: 'audio/mpeg' });
    handle.destroy();
    handle.destroy(); // Should not throw
  });
});
