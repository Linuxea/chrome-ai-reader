/**
 * F13 — podcast "direct mode": the service worker talks to the Volcengine
 * podcast WebSocket itself, without the local Node proxy.
 *
 * The browser WebSocket API cannot set request headers, and the API
 * authenticates the handshake with X-Api-* headers. A declarativeNetRequest
 * session rule adds them, scoped to that one wss URL and to requests from no
 * tab (tabIds [-1]: the worker), and is removed when the session ends. The
 * frame protocol is shared/podcast-frames.ts (a port of the proxy's).
 */

import {
  buildFrame, parseFrame, frameErrorText, bytesToBase64, MsgType, PodcastEvent, type Frame,
} from '../shared/podcast-frames';

export const PODCAST_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
export const PODCAST_RULE_ID = 4201;
/** Fixed App Key the podcast API expects (per Volcengine's docs; same value the proxy sends). */
const PODCAST_APP_KEY = 'aGjiRDfUWi';
const HANDSHAKE_TIMEOUT_MS = 30_000;
const STREAM_TIMEOUT_MS = 120_000;

export interface DirectCredentials {
  appId: string;
  accessKey: string;
  resourceId: string;
  connectId: string;
}

export interface NlpText { speaker: string; text: string }
export interface AudioConfig { format?: string; sample_rate?: number; speech_rate?: number }

type Post = (msg: Record<string, unknown>) => void;

/** Install the header-injection rule for this session. */
export async function installHeaderRule(creds: DirectCredentials): Promise<void> {
  const set = (header: string, value: string) => ({ header, operation: 'set', value });
  const rule = {
    id: PODCAST_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        set('X-Api-App-Id', creds.appId),
        set('X-Api-Access-Key', creds.accessKey),
        set('X-Api-Resource-Id', creds.resourceId),
        set('X-Api-App-Key', PODCAST_APP_KEY),
        set('X-Api-Connect-Id', creds.connectId),
      ],
    },
    condition: { urlFilter: `|${PODCAST_WS_URL}`, resourceTypes: ['websocket'], tabIds: [-1] },
  } as unknown as chrome.declarativeNetRequest.Rule;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PODCAST_RULE_ID], addRules: [rule] });
}

export async function removeHeaderRule(): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PODCAST_RULE_ID] }).catch(() => {});
}

/** Frames of one socket, awaited in order. */
export class FrameQueue {
  private frames: Frame[] = [];
  private waiters: ((f: Frame | null) => void)[] = [];
  private closed: Error | null = null;

  constructor(ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data === 'string') return;
      const frame = parseFrame(ev.data as ArrayBuffer);
      if (!frame) return;
      const waiter = this.waiters.shift();
      if (waiter) waiter(frame); else this.frames.push(frame);
    });
    ws.addEventListener('close', (ev: CloseEvent) => this.close(new Error(`WebSocket closed (${ev.code})${ev.reason ? ': ' + ev.reason : ''}`)));
    ws.addEventListener('error', () => this.close(new Error('WebSocket error')));
  }

  close(reason: Error): void {
    if (this.closed) return;
    this.closed = reason;
    while (this.waiters.length) this.waiters.shift()!(null);
  }

  next(timeoutMs: number): Promise<Frame> {
    const queued = this.frames.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error('WebSocket message timeout'));
      }, timeoutMs);
      const waiter = (f: Frame | null) => {
        clearTimeout(timer);
        if (f) resolve(f); else reject(this.closed ?? new Error('WebSocket closed'));
      };
      this.waiters.push(waiter);
    });
  }

  /** Skip frames until `eventCode`; an error frame rejects. */
  async waitFor(eventCode: number, timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<Frame> {
    for (;;) {
      const f = await this.next(timeoutMs);
      if (f.msgType === MsgType.Error) throw new Error(frameErrorText(f));
      if (f.eventCode === eventCode) return f;
    }
  }
}

function openSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
  });
}

export interface DirectResult {
  /** Audio chunks forwarded — once any were, falling back to the proxy would duplicate audio. */
  audioChunks: number;
}

/**
 * Run one podcast session over a direct WebSocket, forwarding the same
 * messages the proxy's SSE stream produced. Rejects on failure; `signal`
 * aborts (panel closed) and resolves quietly.
 */
export async function runDirectPodcast(
  params: { nlpTexts: NlpText[]; audioConfig?: AudioConfig; creds: DirectCredentials; post: Post; signal?: AbortSignal },
  WebSocketImpl: typeof WebSocket = WebSocket,
): Promise<DirectResult> {
  const { nlpTexts, audioConfig, creds, post, signal } = params;
  const result: DirectResult = { audioChunks: 0 };
  await installHeaderRule(creds);
  const ws = new WebSocketImpl(PODCAST_WS_URL);
  const queue = new FrameQueue(ws);
  const onAbort = () => { queue.close(new Error('aborted')); try { ws.close(); } catch { /* already closed */ } };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await openSocket(ws);
    const sessionId = creds.connectId;
    ws.send(buildFrame(PodcastEvent.StartConnection, '', {}));
    await queue.waitFor(PodcastEvent.ConnectionStarted);
    ws.send(buildFrame(PodcastEvent.StartSession, sessionId, {
      input_id: 'chrome_ext_podcast',
      action: 3,
      nlp_texts: nlpTexts,
      use_head_music: false,
      use_tail_music: false,
      speaker_info: { random_order: true },
      audio_config: {
        format: audioConfig?.format || 'mp3',
        sample_rate: audioConfig?.sample_rate || 24000,
        speech_rate: audioConfig?.speech_rate || 0,
      },
    }));
    await queue.waitFor(PodcastEvent.SessionStarted);
    ws.send(buildFrame(PodcastEvent.FinishSession, sessionId, {}));

    for (;;) {
      const f = await queue.next(STREAM_TIMEOUT_MS);
      const p = (f.payload && typeof f.payload === 'object' ? f.payload : {}) as Record<string, unknown>;
      if (f.msgType === MsgType.Error) throw new Error(frameErrorText(f));
      if (f.msgType === MsgType.AudioOnlyServer && f.eventCode === PodcastEvent.PodcastRoundResponse) {
        if (f.payload instanceof Uint8Array && f.payload.length) {
          post({ type: 'audio_chunk', data: bytesToBase64(f.payload) });
          result.audioChunks++;
        }
      } else if (f.eventCode === PodcastEvent.PodcastRoundStart) {
        post({ type: 'round_start', idx: p.round_id, speaker: p.speaker });
      } else if (f.eventCode === PodcastEvent.PodcastRoundEnd) {
        post({ type: 'round_end', audioDuration: p.audio_duration, startTime: p.start_time, endTime: p.end_time });
      } else if (f.eventCode === PodcastEvent.SessionFailed) {
        throw new Error(frameErrorText(f));
      } else if (f.eventCode === PodcastEvent.SessionFinished) {
        post({ type: 'done' });
        try { ws.send(buildFrame(PodcastEvent.FinishConnection, '', {})); } catch { /* closing anyway */ }
        break;
      }
    }
  } catch (e) {
    if (!signal?.aborted) throw Object.assign(e as Error, { audioChunks: result.audioChunks });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { ws.close(); } catch { /* already closed */ }
    await removeHeaderRule();
  }
  return result;
}
