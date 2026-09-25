/**
 * F13 — Volcengine podcast WebSocket binary frames, for the service worker's
 * direct mode. A TypeScript port of proxy/server.js buildFrame / parseFrame
 * (the proxy is a separate Node package and keeps its own copy; a test pins
 * the two to the same bytes).
 */

export const MsgType = {
  FullClientRequest: 0b1,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  Error: 0b1111,
} as const;

export const PodcastEvent = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFinished: 52,
  StartSession: 100,
  FinishSession: 102,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  PodcastRoundStart: 360,
  PodcastRoundResponse: 361,
  PodcastRoundEnd: 362,
  PodcastEnd: 363,
} as const;

export interface Frame {
  msgType: number;
  eventCode: number | null;
  sessionId: string;
  errorCode: number | null;
  /** Parsed JSON, or raw bytes (audio / non-JSON). */
  payload: unknown;
}

const CONNECTION_EVENTS: number[] = [
  PodcastEvent.StartConnection, PodcastEvent.FinishConnection, PodcastEvent.ConnectionStarted, PodcastEvent.ConnectionFinished,
];

export function buildFrame(eventType: number, sessionId: string, payloadObj: unknown): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const payload = enc.encode(JSON.stringify(payloadObj));
  const hasSessionId = eventType !== PodcastEvent.StartConnection
    && eventType !== PodcastEvent.FinishConnection
    && eventType !== PodcastEvent.ConnectionStarted;
  const sid = sessionId ? enc.encode(sessionId) : new Uint8Array(0);

  const frame = new Uint8Array(4 + 4 + (hasSessionId ? 4 + sid.length : 0) + 4 + payload.length);
  const dv = new DataView(frame.buffer);
  // version 1 / header size 1 · full client request, with event · JSON, no compression
  frame.set([0x11, 0x14, 0x10, 0x00], 0);
  let offset = 4;
  dv.setInt32(offset, eventType, false);
  offset += 4;
  if (hasSessionId) {
    dv.setUint32(offset, sid.length, false);
    offset += 4;
    frame.set(sid, offset);
    offset += sid.length;
  }
  dv.setUint32(offset, payload.length, false);
  frame.set(payload, offset + 4);
  return frame;
}

export function parseFrame(data: ArrayBuffer | Uint8Array): Frame | null {
  const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (arr.length < 4) return null;
  const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  const msgType = (arr[1] >> 4) & 0xf;
  const flag = arr[1] & 0xf;
  let offset = 4;
  let eventCode: number | null = null;
  let sessionId = '';
  let errorCode: number | null = null;
  let payload: unknown = null;

  if (msgType === MsgType.Error && offset + 4 <= arr.length) {
    errorCode = dv.getUint32(offset, false);
    offset += 4;
  }
  if (flag === 0b100) {
    if (offset + 4 <= arr.length) {
      eventCode = dv.getInt32(offset, false);
      offset += 4;
    }
    if (eventCode === null || !CONNECTION_EVENTS.includes(eventCode)) {
      if (offset + 4 <= arr.length) {
        const len = dv.getUint32(offset, false);
        offset += 4;
        if (len > 0 && offset + len <= arr.length) {
          sessionId = new TextDecoder().decode(arr.slice(offset, offset + len));
          offset += len;
        }
      }
    }
  }
  if (offset + 4 <= arr.length) {
    const len = dv.getUint32(offset, false);
    offset += 4;
    if (len > 0 && offset + len <= arr.length) {
      const bytes = arr.slice(offset, offset + len);
      if (msgType === MsgType.AudioOnlyServer) payload = bytes;
      else {
        try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { payload = bytes; }
      }
    }
  }
  return { msgType, eventCode, sessionId, errorCode, payload };
}

/** Human-readable text of an error frame's payload. */
export function frameErrorText(frame: Frame): string {
  const p = frame.payload;
  if (p instanceof Uint8Array) return new TextDecoder().decode(p);
  if (p && typeof p === 'object' && 'message' in p) return String((p as { message: unknown }).message);
  return JSON.stringify(p);
}

/** base64 of bytes (the port carries audio as base64 strings). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
