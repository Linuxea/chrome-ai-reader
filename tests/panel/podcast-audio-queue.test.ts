import { vi, describe, it, expect } from 'vitest';

vi.mock('@/panel/lib/tts-controller', () => ({ stopAllTTS: vi.fn() }));
const { store } = vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };
  function createStorageArea(storeKey: string) {
    return {
      get(keys: unknown, cb?: (r: unknown) => void) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store[storeKey][k as string] !== undefined) result[k as string] = store[storeKey][k as string]; });
        if (cb) { cb(result); return; }
        return Promise.resolve(result);
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.entries(items).forEach(([k, v]) => { store[storeKey][k] = v; });
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
      remove(keys: unknown, cb?: () => void) {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[storeKey][k as string]);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
    };
  }
  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect: vi.fn(() => ({
        name: 'ai-chat',
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store };
});

import { OrderedChunkQueue } from '@/panel/lib/podcast-controller';

/** Sink that records appends and enforces one-in-flight, completing only
 *  when the test calls `finish()` (mirrors the sourcebuffer updateend). */
function makeControlledSink() {
  const appended: ArrayBuffer[] = [];
  const sink = {
    append(chunk: ArrayBuffer) {
      if (sink.busy) throw new Error('overlapping append — one in flight only');
      sink.busy = true;
      appended.push(chunk);
    },
    finish() {
      sink.busy = false;
    },
    busy: false,
  };
  return { sink, appended };
}

describe('OrderedChunkQueue — ordered delivery to MSE', () => {
  it('delivers chunks strictly in arrival order, one at a time', () => {
    const { sink, appended } = makeControlledSink();
    const q = new OrderedChunkQueue(sink);
    const a = new ArrayBuffer(1);
    const b = new ArrayBuffer(2);
    const c = new ArrayBuffer(3);

    q.push(a);
    expect(appended).toHaveLength(1); // accepted immediately
    q.push(b);
    q.push(c); // sink busy — must queue, not append
    expect(appended).toHaveLength(1);
    expect(q.length).toBe(2);

    sink.finish();
    q.notifyAppendEnd(); // b goes out
    expect(appended).toHaveLength(2);
    expect(q.length).toBe(1);

    sink.finish();
    q.notifyAppendEnd(); // c goes out
    expect(appended).toHaveLength(3);
    expect(q.length).toBe(0);
    expect(appended[0]).toBe(a);
    expect(appended[1]).toBe(b);
    expect(appended[2]).toBe(c);
  });

  it('holds chunks while the sink cannot accept (pre-sourceopen window) and drains once ready', () => {
    const { sink, appended } = makeControlledSink();
    let ready = false;
    const q = new OrderedChunkQueue(sink, 50, () => ready);

    q.push(new ArrayBuffer(1));
    q.push(new ArrayBuffer(2));
    expect(appended).toHaveLength(0); // nothing lost, nothing sent
    expect(q.length).toBe(2);

    ready = true;
    q.pump();
    expect(appended).toHaveLength(1);

    sink.finish();
    q.notifyAppendEnd();
    expect(appended).toHaveLength(2);
  });

  it('drops the OLDEST chunk when the cap is hit (streaming backpressure)', () => {
    const { sink, appended } = makeControlledSink();
    const q = new OrderedChunkQueue(sink, 2);
    q.push(new ArrayBuffer(1)); // in flight with the sink
    q.push(new ArrayBuffer(2)); // queued
    q.push(new ArrayBuffer(3)); // queued — queue now at the cap (2)
    q.push(new ArrayBuffer(4)); // cap hit: the OLDEST queued chunk (#2) drops
    expect(q.length).toBe(2);
    expect(q.pending.map(c => c.byteLength)).toEqual([3, 4]);

    sink.finish();
    q.notifyAppendEnd();
    // The surviving queued chunks are the NEWEST two.
    expect(appended[1].byteLength).toBe(3);
    expect(q.length).toBe(1);
  });

  it('a synchronously throwing sink loses that chunk but keeps flowing', () => {
    let calls = 0;
    const q = new OrderedChunkQueue({
      append: () => {
        calls += 1;
        if (calls === 1) throw new Error('appendBuffer quota exceeded');
      },
    });
    const first = new ArrayBuffer(1);
    const second = new ArrayBuffer(2);
    q.push(first); // throws synchronously — dropped
    q.push(second); // queue must continue
    expect(q.appending).toBe(true);
    expect(q.pending).toHaveLength(0);
    q.notifyAppendEnd();
    expect(calls).toBe(2);
  });
});
