import { vi, describe, it, expect, beforeEach } from 'vitest';
import { runDirectPodcast, FrameQueue, PODCAST_RULE_ID, PODCAST_WS_URL } from '../../src/background/podcast-direct';
import { MsgType, PodcastEvent, parseFrame } from '../../src/shared/podcast-frames';

const CONNECTION = new Set<number>([PodcastEvent.StartConnection, PodcastEvent.FinishConnection, PodcastEvent.ConnectionStarted, PodcastEvent.ConnectionFinished]);

/** A server → client frame. */
function serverFrame(msgType: number, event: number, payload: unknown, sid = 'sess'): ArrayBuffer {
  const enc = new TextEncoder();
  const body = payload instanceof Uint8Array ? payload : enc.encode(JSON.stringify(payload));
  const sidBytes = CONNECTION.has(event) ? null : enc.encode(sid);
  const out = new Uint8Array(4 + 4 + (sidBytes ? 4 + sidBytes.length : 0) + 4 + body.length);
  const dv = new DataView(out.buffer);
  out.set([0x11, (msgType << 4) | 0b0100, 0x10, 0]);
  let o = 4;
  dv.setInt32(o, event); o += 4;
  if (sidBytes) { dv.setUint32(o, sidBytes.length); o += 4; out.set(sidBytes, o); o += sidBytes.length; }
  dv.setUint32(o, body.length); out.set(body, o + 4);
  return out.buffer;
}

type Script = (event: number, ws: FakeWS) => void;

class FakeWS extends EventTarget {
  static last: FakeWS;
  static script: Script = () => {};
  static failOpen = false;
  binaryType = 'blob';
  sent: number[] = [];
  closed = false;
  constructor(public url: string) {
    super();
    FakeWS.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event(FakeWS.failOpen ? 'error' : 'open')));
  }
  send(data: Uint8Array) {
    const event = parseFrame(data)!.eventCode!;
    this.sent.push(event);
    queueMicrotask(() => FakeWS.script(event, this));
  }
  receive(buf: ArrayBuffer) { this.dispatchEvent(Object.assign(new Event('message'), { data: buf })); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, reason: '' }));
  }
}

const happy: Script = (event, ws) => {
  const R = MsgType.FullServerResponse;
  if (event === PodcastEvent.StartConnection) ws.receive(serverFrame(R, PodcastEvent.ConnectionStarted, {}));
  if (event === PodcastEvent.StartSession) ws.receive(serverFrame(R, PodcastEvent.SessionStarted, {}));
  if (event === PodcastEvent.FinishSession) {
    ws.receive(serverFrame(R, PodcastEvent.PodcastRoundStart, { round_id: 0, speaker: 'A' }));
    ws.receive(serverFrame(MsgType.AudioOnlyServer, PodcastEvent.PodcastRoundResponse, new Uint8Array([1, 2, 3])));
    ws.receive(serverFrame(R, PodcastEvent.PodcastRoundEnd, { audio_duration: 1.5, start_time: 0, end_time: 1.5 }));
    ws.receive(serverFrame(R, PodcastEvent.SessionFinished, {}));
  }
};

const updateSessionRules = vi.fn(() => Promise.resolve());
vi.stubGlobal('chrome', { declarativeNetRequest: { updateSessionRules } });

const creds = { appId: 'app', accessKey: 'key', resourceId: 'res', connectId: 'sess' };
const nlpTexts = [{ speaker: 'A', text: 'hi' }];

beforeEach(() => {
  vi.clearAllMocks();
  FakeWS.script = happy;
  FakeWS.failOpen = false;
});

describe('runDirectPodcast', () => {
  it('injects auth headers for the podcast socket only, streams rounds, then removes the rule', async () => {
    const post = vi.fn();
    const res = await runDirectPodcast({ nlpTexts, creds, post }, FakeWS as unknown as typeof WebSocket);

    const add = (updateSessionRules.mock.calls[0] as unknown as [{ addRules: chrome.declarativeNetRequest.Rule[] }])[0].addRules[0];
    expect(add.id).toBe(PODCAST_RULE_ID);
    expect(add.condition).toEqual({ urlFilter: `|${PODCAST_WS_URL}`, resourceTypes: ['websocket'], tabIds: [-1] });
    expect(add.action.requestHeaders).toContainEqual({ header: 'X-Api-Access-Key', operation: 'set', value: 'key' });
    expect(updateSessionRules).toHaveBeenLastCalledWith({ removeRuleIds: [PODCAST_RULE_ID] });

    expect(FakeWS.last.url).toBe(PODCAST_WS_URL);
    expect(FakeWS.last.binaryType).toBe('arraybuffer');
    expect(FakeWS.last.sent).toEqual([PodcastEvent.StartConnection, PodcastEvent.StartSession, PodcastEvent.FinishSession, PodcastEvent.FinishConnection]);
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      { type: 'round_start', idx: 0, speaker: 'A' },
      { type: 'audio_chunk', data: 'AQID' },
      { type: 'round_end', audioDuration: 1.5, startTime: 0, endTime: 1.5 },
      { type: 'done' },
    ]);
    expect(res.audioChunks).toBe(1);
  });

  it('rejects when the handshake fails, still removing the rule', async () => {
    FakeWS.failOpen = true;
    await expect(runDirectPodcast({ nlpTexts, creds, post: vi.fn() }, FakeWS as unknown as typeof WebSocket)).rejects.toThrow('connection failed');
    expect(updateSessionRules).toHaveBeenLastCalledWith({ removeRuleIds: [PODCAST_RULE_ID] });
  });

  it('reports an error frame with the audio already sent', async () => {
    FakeWS.script = (event, ws) => {
      happy(event === PodcastEvent.FinishSession ? -1 : event, ws);
      if (event === PodcastEvent.FinishSession) {
        ws.receive(serverFrame(MsgType.AudioOnlyServer, PodcastEvent.PodcastRoundResponse, new Uint8Array([9])));
        ws.receive(serverFrame(MsgType.FullServerResponse, PodcastEvent.SessionFailed, { message: 'quota exceeded' }));
      }
    };
    const err = await runDirectPodcast({ nlpTexts, creds, post: vi.fn() }, FakeWS as unknown as typeof WebSocket).catch((e) => e);
    expect(err.message).toBe('quota exceeded');
    expect(err.audioChunks).toBe(1);
  });

  it('resolves quietly when aborted', async () => {
    const ctrl = new AbortController();
    FakeWS.script = (event, ws) => { if (event === PodcastEvent.StartConnection) ws.receive(serverFrame(MsgType.FullServerResponse, PodcastEvent.ConnectionStarted, {})); if (event === PodcastEvent.StartSession) ctrl.abort(); };
    const res = await runDirectPodcast({ nlpTexts, creds, post: vi.fn(), signal: ctrl.signal }, FakeWS as unknown as typeof WebSocket);
    expect(res.audioChunks).toBe(0);
    expect(FakeWS.last.closed).toBe(true);
  });
});

describe('FrameQueue', () => {
  it('times out a wait and rejects after close', async () => {
    vi.useFakeTimers();
    const ws = new FakeWS('x');
    const q = new FrameQueue(ws as unknown as WebSocket);
    const p = q.next(1000);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow('timeout');
    vi.useRealTimers();
    ws.close();
    await expect(q.next(1000)).rejects.toThrow('closed (1000)');
  });

  it('turns an error frame into a rejection', async () => {
    const ws = new FakeWS('x');
    const q = new FrameQueue(ws as unknown as WebSocket);
    const out = new Uint8Array(4 + 4 + 4 + 5);
    out.set([0x11, (MsgType.Error << 4), 0x10, 0]);
    new DataView(out.buffer).setUint32(4, 45000001);
    new DataView(out.buffer).setUint32(8, 5);
    out.set(new TextEncoder().encode('"bad"'), 12);
    ws.receive(out.buffer);
    await expect(q.waitFor(PodcastEvent.ConnectionStarted)).rejects.toThrow('bad');
  });
});
