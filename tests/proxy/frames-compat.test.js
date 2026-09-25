/**
 * F13: the worker's direct mode (src/shared/podcast-frames.ts) and the proxy
 * (proxy/server.js) must speak the same bytes.
 */
import { vi, describe, it, expect } from 'vitest';

vi.mock('ws', () => ({ WebSocket: vi.fn() }));
vi.mock('http', () => ({ createServer: vi.fn(() => ({ listen: vi.fn() })) }));

import { createRequire } from 'module';
import * as ts from '../../src/shared/podcast-frames';
const require = createRequire(import.meta.url);
const proxy = require('../../proxy/server.js');

describe('podcast frames: TS port ≡ proxy', () => {
  it('shares the constants', () => {
    expect(ts.MsgType).toEqual(proxy.MsgType);
    expect(ts.PodcastEvent).toEqual(proxy.PodcastEvent);
  });

  it.each([
    [ts.PodcastEvent.StartConnection, '', {}],
    [ts.PodcastEvent.StartSession, 'sess-1', { nlp_texts: [{ speaker: 'A', text: '你好' }], action: 3 }],
    [ts.PodcastEvent.FinishSession, 'sess-1', {}],
    [ts.PodcastEvent.FinishConnection, '', {}],
  ])('builds identical frames for event %i', (event, sid, payload) => {
    expect(Array.from(ts.buildFrame(event, sid, payload))).toEqual(Array.from(proxy.buildFrame(event, sid, payload)));
  });

  it('parses each other\'s frames the same way', () => {
    const frame = proxy.buildFrame(ts.PodcastEvent.StartSession, 'abc', { x: 1 });
    expect(ts.parseFrame(frame)).toEqual(proxy.parseFrame(frame));
  });
});
