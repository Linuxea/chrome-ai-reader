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
  const delivered = [];
  const events = { drained: false, error: null };
  const engine = new TTSSynthEngine({
    voice,
    getBufferedAheadMs: () => 0,
    onSegmentAudio: (bytes) => delivered.push(bytes),
    onDrained: () => { events.drained = true; },
    onError: (m) => { events.error = m; },
    ...overrides,
  });
  return { engine, delivered, events };
}

async function deliveredText(delivered) {
  return Promise.all(delivered.map((bytes) => new Blob([bytes]).text()));
}

describe('TTSSynthEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.getCachedSegmentAudio.mockResolvedValue(null);
  });

  it('pipelines two segments concurrently but delivers strictly in order', async () => {
    const ports = freshPorts();
    const { engine, delivered, events } = makeEngine();
    engine.enqueue('seg one');
    engine.enqueue('seg two');
    engine.endInput();

    await vi.waitFor(() => expect(ports.length).toBe(2)); // concurrent, not serial

    // Second segment finishes FIRST (out of order) — must not be delivered yet
    ports[1]._simulateMessage({ type: 'chunk', data: b64('B') });
    ports[1]._simulateMessage({ type: 'done' });
    expect(delivered.length).toBe(0);
    expect(events.drained).toBe(false);

    // Segment one completes → both deliver, in index order
    ports[0]._simulateMessage({ type: 'chunk', data: b64('A1') });
    ports[0]._simulateMessage({ type: 'chunk', data: b64('A2') });
    ports[0]._simulateMessage({ type: 'done' });

    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(await deliveredText(delivered)).toEqual(['A1A2', 'B']); // one segment = one complete mp3
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
    const { engine, delivered, events } = makeEngine();
    engine.enqueue('warm');
    engine.endInput();

    await vi.waitFor(() => expect(events.drained).toBe(true));
    expect(ports.length).toBe(0);
    expect((await deliveredText(delivered))[0]).toBe('cached-audio');
  });

  it('backpressure: no dispatch while playable audio exceeds the lookahead', async () => {
    const ports = freshPorts();
    let ahead = 40_000; // > 30s default lookahead
    const { engine, delivered } = makeEngine({ getBufferedAheadMs: () => ahead });

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
    await vi.waitFor(() => expect(delivered.length).toBe(2));
    expect((await deliveredText(delivered)).join('')).toBe('ab');
  });

  it('retries a failed segment once, then succeeds', async () => {
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
    const { engine, delivered, events } = makeEngine();
    engine.enqueue('one');
    await vi.waitFor(() => expect(ports.length).toBe(1));

    engine.abort();
    expect(ports[0].disconnect).toHaveBeenCalled();

    ports[0]._simulateMessage({ type: 'chunk', data: b64('late') });
    ports[0]._simulateMessage({ type: 'error', error: 'late' });
    await sleep(30);
    expect(delivered.length).toBe(0);
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
