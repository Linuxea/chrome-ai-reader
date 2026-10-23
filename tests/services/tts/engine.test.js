import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/tts-cache.js', () => ({
  ttsCacheKey: vi.fn(async (_voice, text) => `k:${text}`),
  getCachedSegmentAudio: vi.fn(async () => null),
  putSegmentAudio: vi.fn(async () => {}),
}));

import * as cacheMock from '../../../src/shared/tts-cache.js';

const { createMockPort } = await import('../../helpers/chrome-mock.js');

vi.hoisted(() => {
  globalThis.chrome = { runtime: { connect: vi.fn(() => null) } };
});

import { TTSSynthEngine, getTTSVoice } from '../../../src/side_panel/services/tts/engine.js';

const b64 = (s) => btoa(s);
const voice = Promise.resolve({ speaker: 'spk', resourceId: 'res' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function freshPorts() {
  const ports = [];
  chrome.runtime.connect.mockImplementation(() => {
    const p = createMockPort('tts');
    ports.push(p);
    return p;
  });
  return ports;
}

function makeEngine(overrides = {}) {
  const chunks = [];
  const events = { drained: false, error: null };
  const engine = new TTSSynthEngine({
    voice,
    getBufferedAheadMs: () => 0,
    onHeadChunk: (b) => chunks.push(b),
    onDrained: () => { events.drained = true; },
    onError: (m) => { events.error = m; },
    ...overrides,
  });
  return { engine, chunks, events };
}

async function chunksText(chunks) {
  return new Blob(chunks).text();
}

describe('TTSSynthEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.getCachedSegmentAudio.mockResolvedValue(null);
  });

  it('pipelines two segments concurrently and delivers bytes strictly in order', async () => {
    const ports = freshPorts();
    const { engine, chunks, events } = makeEngine();
    engine.enqueue('seg one');
    engine.enqueue('seg two');
    engine.endInput();

    await vi.waitFor(() => expect(ports.length).toBe(2)); // concurrent, not serial

    // Second segment finishes FIRST (out of order) — must not emit yet
    ports[1]._simulateMessage({ type: 'chunk', data: b64('B1') });
    ports[1]._simulateMessage({ type: 'done' });
    expect(chunks.length).toBe(0);
    expect(events.drained).toBe(false);

    // Head streams live
    ports[0]._simulateMessage({ type: 'chunk', data: b64('A1') });
    expect(chunks.length).toBe(1);
    ports[0]._simulateMessage({ type: 'done' });

    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(await chunksText(chunks)).toBe('A1B1');
  });

  it('writes each synthesized segment to the cache exactly once (duplicate done ignored)', async () => {
    const ports = freshPorts();
    const { engine, events } = makeEngine();
    engine.enqueue('only');
    engine.endInput();
    await vi.waitFor(() => expect(ports.length).toBe(1));

    ports[0]._simulateMessage({ type: 'chunk', data: b64('abc') });
    ports[0]._simulateMessage({ type: 'done' });
    ports[0]._simulateMessage({ type: 'done' }); // 152 may arrive twice

    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(cacheMock.putSegmentAudio).toHaveBeenCalledTimes(1);
    expect(cacheMock.putSegmentAudio).toHaveBeenCalledWith('k:only', expect.any(Blob));
  });

  it('serves a cache hit without opening any port', async () => {
    cacheMock.getCachedSegmentAudio.mockResolvedValue(new Blob(['cached-audio']));
    const ports = freshPorts();
    const { engine, chunks, events } = makeEngine();
    engine.enqueue('warm');
    engine.endInput();

    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(ports.length).toBe(0);
    expect(await chunksText(chunks)).toBe('cached-audio');
  });

  it('slices oversized audio buffers into append-sized pieces (uniform append cadence)', async () => {
    const big = 'A'.repeat(150 * 1024);
    cacheMock.getCachedSegmentAudio.mockResolvedValue(new Blob([big]));
    const ports = freshPorts();
    const { engine, chunks, events } = makeEngine();
    engine.enqueue('big');
    engine.endInput();

    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(ports.length).toBe(0);
    expect(chunks.length).toBe(5); // 150KB / 32KB → 5 pieces, never one giant append
    expect(chunks.every(c => c.byteLength <= 32 * 1024)).toBe(true);
    expect(await chunksText(chunks)).toBe(big);
  });

  it('backpressure: no dispatch while buffered ahead exceeds the lookahead', async () => {
    const ports = freshPorts();
    let ahead = 40_000; // > 30s default lookahead
    const { engine, chunks, events } = makeEngine({ getBufferedAheadMs: () => ahead });

    engine.enqueue('one');
    engine.enqueue('two');
    engine.endInput();
    await sleep(60);
    expect(ports.length).toBe(0); // throttled before any request went out

    ahead = 0;
    engine.notifyProgress(); // playback advanced — dispatch resumes
    await vi.waitFor(() => expect(ports.length).toBe(2));

    ports[0]._simulateMessage({ type: 'chunk', data: b64('a') });
    ports[0]._simulateMessage({ type: 'done' });
    ports[1]._simulateMessage({ type: 'chunk', data: b64('b') });
    ports[1]._simulateMessage({ type: 'done' });
    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(await chunksText(chunks)).toBe('ab');
  });

  it('retries a failed segment once (nothing streamed yet), then succeeds', async () => {
    const ports = freshPorts();
    const { engine, events } = makeEngine();
    engine.enqueue('flaky');
    engine.endInput();
    await vi.waitFor(() => expect(ports.length).toBe(1));

    ports[0]._simulateMessage({ type: 'error', error: 'boom' });
    expect(events.error).toBeNull(); // retry pending, playback not failed
    expect(ports.length).toBe(1);

    await vi.waitFor(() => expect(ports.length).toBe(2), { timeout: 2000 }); // ~300ms backoff
    ports[1]._simulateMessage({ type: 'chunk', data: b64('ok') });
    ports[1]._simulateMessage({ type: 'done' });
    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(events.error).toBeNull();
  });

  it('fails immediately (no retry) once bytes already streamed — output is not resumable', async () => {
    const ports = freshPorts();
    const { engine, events } = makeEngine();
    engine.enqueue('partial');
    engine.endInput();
    await vi.waitFor(() => expect(ports.length).toBe(1));

    ports[0]._simulateMessage({ type: 'chunk', data: b64('partial-bytes') });
    ports[0]._simulateMessage({ type: 'error', error: 'mid-stream failure' });

    expect(events.error).toBe('mid-stream failure');
  });

  it('second failure after retry aborts the engine with onError', async () => {
    const ports = freshPorts();
    const { engine, events } = makeEngine();
    engine.enqueue('doomed');
    engine.endInput();
    await vi.waitFor(() => expect(ports.length).toBe(1));

    ports[0]._simulateMessage({ type: 'error', error: 'first' });
    await vi.waitFor(() => expect(ports.length).toBe(2), { timeout: 2000 });
    ports[1]._simulateMessage({ type: 'error', error: 'second' });

    expect(events.error).toBe('second');
  });

  it('abort closes live ports and suppresses every later callback', async () => {
    const ports = freshPorts();
    const { engine, chunks, events } = makeEngine();
    engine.enqueue('one');
    await vi.waitFor(() => expect(ports.length).toBe(1));

    engine.abort();
    expect(ports[0].disconnect).toHaveBeenCalled();

    ports[0]._simulateMessage({ type: 'chunk', data: b64('late') });
    ports[0]._simulateMessage({ type: 'error', error: 'late' });
    await sleep(30);
    expect(chunks.length).toBe(0);
    expect(events.error).toBeNull();
    expect(events.drained).toBe(false);
  });

  it('endInput with nothing enqueued drains immediately', async () => {
    freshPorts();
    const { engine, events } = makeEngine();
    engine.endInput();
    expect(events.drained).toBe(true);
  });

  it('enqueue after endInput is ignored', async () => {
    const ports = freshPorts();
    const { engine } = makeEngine();
    engine.endInput();
    engine.enqueue('late');
    await sleep(30);
    expect(ports.length).toBe(0);
  });

  it('ignores empty/whitespace segments', async () => {
    const ports = freshPorts();
    const { engine, events } = makeEngine();
    engine.enqueue('   ');
    engine.enqueue('');
    engine.endInput();
    await sleep(30);
    expect(ports.length).toBe(0);
    expect(events.drained).toBe(true);
  });

  it('getTTSVoice falls back to defaults when settings are unavailable', async () => {
    const v = await getTTSVoice();
    expect(v.speaker).toBe('zh_female_vv_uranus_bigtts');
    expect(v.resourceId).toBe('seed-tts-2.0');
  });
});
