import { vi, describe, it, expect } from 'vitest';

// Mock ws and http so server.js doesn't actually start a server
vi.mock('ws', () => ({ WebSocket: vi.fn() }));
vi.mock('http', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn(),
  })),
}));

// server.js is CJS — use createRequire to import it
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildFrame, parseFrame, MsgType, PodcastEvent } = require('../../proxy/server.js');

// --- Constants tests ---

describe('MsgType constants', () => {
  it('has expected values', () => {
    expect(MsgType.FullClientRequest).toBe(0b1);
    expect(MsgType.FullServerResponse).toBe(0b1001);
    expect(MsgType.AudioOnlyServer).toBe(0b1011);
    expect(MsgType.Error).toBe(0b1111);
  });
});

describe('PodcastEvent constants', () => {
  it('has expected values', () => {
    expect(PodcastEvent.StartConnection).toBe(1);
    expect(PodcastEvent.FinishConnection).toBe(2);
    expect(PodcastEvent.ConnectionStarted).toBe(50);
    expect(PodcastEvent.ConnectionFinished).toBe(52);
    expect(PodcastEvent.StartSession).toBe(100);
    expect(PodcastEvent.FinishSession).toBe(102);
    expect(PodcastEvent.SessionStarted).toBe(150);
    expect(PodcastEvent.SessionFinished).toBe(152);
    expect(PodcastEvent.SessionFailed).toBe(153);
    expect(PodcastEvent.PodcastRoundStart).toBe(360);
    expect(PodcastEvent.PodcastRoundResponse).toBe(361);
    expect(PodcastEvent.PodcastRoundEnd).toBe(362);
    expect(PodcastEvent.PodcastEnd).toBe(363);
  });
});

// --- buildFrame tests ---

describe('buildFrame', () => {
  it('sets the 4-byte header to 0x11 0x14 0x10 0x00', () => {
    const frame = buildFrame(PodcastEvent.StartConnection, '', {});
    expect(frame[0]).toBe(0x11);
    expect(frame[1]).toBe(0x14);
    expect(frame[2]).toBe(0x10);
    expect(frame[3]).toBe(0x00);
  });

  it('writes event code as big-endian int32', () => {
    const frame = buildFrame(PodcastEvent.StartConnection, '', {});
    const dv = new DataView(frame.buffer, 4, 4);
    // StartConnection = 1
    expect(dv.getInt32(0, false)).toBe(PodcastEvent.StartConnection);
  });

  it('omits sessionId for StartConnection', () => {
    // StartConnection frame: 4 header + 4 eventCode + 4 payloadLen + payload
    const payload = { test: true };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const expectedSize = 4 + 4 + 4 + payloadBytes.length;
    const frame = buildFrame(PodcastEvent.StartConnection, '', payload);
    expect(frame.length).toBe(expectedSize);
  });

  it('omits sessionId for FinishConnection', () => {
    const payload = { test: true };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const expectedSize = 4 + 4 + 4 + payloadBytes.length;
    const frame = buildFrame(PodcastEvent.FinishConnection, '', payload);
    expect(frame.length).toBe(expectedSize);
  });

  it('omits sessionId for ConnectionStarted', () => {
    const payload = { test: true };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const expectedSize = 4 + 4 + 4 + payloadBytes.length;
    const frame = buildFrame(PodcastEvent.ConnectionStarted, '', payload);
    expect(frame.length).toBe(expectedSize);
  });

  it('includes sessionId for StartSession', () => {
    const sid = 'sess-123';
    const sidBytes = new TextEncoder().encode(sid);
    const payload = { action: 3 };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    // 4 header + 4 eventCode + 4 sidLen + sidBytes + 4 payloadLen + payloadBytes
    const expectedSize = 4 + 4 + 4 + sidBytes.length + 4 + payloadBytes.length;
    const frame = buildFrame(PodcastEvent.StartSession, sid, payload);
    expect(frame.length).toBe(expectedSize);
  });

  it('encodes payload as UTF-8 JSON', () => {
    const payload = { hello: 'world' };
    const frame = buildFrame(PodcastEvent.StartConnection, '', payload);
    // After header(4) + eventCode(4), read payload length then payload
    const offset = 8;
    const payLen = new DataView(frame.buffer, offset, 4).getUint32(0, false);
    const payloadStr = new TextDecoder().decode(frame.slice(offset + 4, offset + 4 + payLen));
    expect(JSON.parse(payloadStr)).toEqual(payload);
  });
});

// --- parseFrame tests ---

describe('parseFrame', () => {
  it('round-trips StartConnection (no sessionId)', () => {
    const payload = { app: 'test' };
    const frame = buildFrame(PodcastEvent.StartConnection, '', payload);
    const parsed = parseFrame(frame.buffer);
    expect(parsed).not.toBeNull();
    expect(parsed.msgType).toBe(MsgType.FullClientRequest);
    expect(parsed.eventCode).toBe(PodcastEvent.StartConnection);
    expect(parsed.sessionId).toBe('');
    expect(parsed.payload).toEqual(payload);
  });

  it('round-trips StartSession (with sessionId)', () => {
    const sid = 'session-abc-456';
    const payload = { action: 3, nlp_texts: ['hello'] };
    const frame = buildFrame(PodcastEvent.StartSession, sid, payload);
    const parsed = parseFrame(frame.buffer);
    expect(parsed).not.toBeNull();
    expect(parsed.eventCode).toBe(PodcastEvent.StartSession);
    expect(parsed.sessionId).toBe(sid);
    expect(parsed.payload).toEqual(payload);
  });

  it('returns null for data shorter than 4 bytes', () => {
    expect(parseFrame(new Uint8Array(3).buffer)).toBeNull();
    expect(parseFrame(new Uint8Array(0).buffer)).toBeNull();
  });

  it('parses an error frame', () => {
    // Build an error frame manually: header with msgType=Error (0b1111), flag=0
    // byte[0] = 0x11, byte[1] = (msgType << 4) | flag = (0xF << 4) | 0 = 0xF0
    // byte[2] = 0x10, byte[3] = 0x00
    const errCode = 4001;
    const payload = new TextEncoder().encode(JSON.stringify({ message: 'fail' }));
    const frame = new Uint8Array(4 + 4 + 4 + payload.length);
    frame[0] = 0x11;
    frame[1] = 0xF0; // msgType=0xF (Error), flag=0
    frame[2] = 0x10;
    frame[3] = 0x00;
    // Error code (4 bytes big-endian)
    new DataView(frame.buffer, 4, 4).setUint32(0, errCode, false);
    // Payload length + payload
    new DataView(frame.buffer, 8, 4).setUint32(0, payload.length, false);
    frame.set(payload, 12);

    const parsed = parseFrame(frame.buffer);
    expect(parsed).not.toBeNull();
    expect(parsed.msgType).toBe(MsgType.Error);
    expect(parsed.errorCode).toBe(errCode);
    expect(parsed.payload).toEqual({ message: 'fail' });
  });

  it('handles AudioOnlyServer payload as raw bytes', () => {
    // Build a frame with msgType=AudioOnlyServer (0b1011), flag=0b100 (WithEvent)
    // byte[1] = (0xB << 4) | 0x4 = 0xB4
    const audioData = new Uint8Array([1, 2, 3, 4, 5]);
    const sessionId = 'sess';
    const sidBytes = new TextEncoder().encode(sessionId);
    const offset = 4;
    const frame = new Uint8Array(
      4 + 4 + (4 + sidBytes.length) + 4 + audioData.length,
    );
    frame[0] = 0x11;
    frame[1] = 0xB4; // AudioOnlyServer + WithEvent
    frame[2] = 0x10;
    frame[3] = 0x00;
    let pos = offset;
    // Event code — use PodcastRoundResponse (361)
    new DataView(frame.buffer, pos, 4).setInt32(0, PodcastEvent.PodcastRoundResponse, false);
    pos += 4;
    // Session ID
    new DataView(frame.buffer, pos, 4).setUint32(0, sidBytes.length, false);
    pos += 4;
    frame.set(sidBytes, pos);
    pos += sidBytes.length;
    // Payload
    new DataView(frame.buffer, pos, 4).setUint32(0, audioData.length, false);
    pos += 4;
    frame.set(audioData, pos);

    const parsed = parseFrame(frame.buffer);
    expect(parsed).not.toBeNull();
    expect(parsed.msgType).toBe(MsgType.AudioOnlyServer);
    expect(parsed.payload).toBeInstanceOf(Uint8Array);
    expect(Array.from(parsed.payload)).toEqual([1, 2, 3, 4, 5]);
  });
});
