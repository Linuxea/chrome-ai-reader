/**
 * Pipelined TTS synthesis engine.
 *
 * Owns ports, ordering, backpressure, retries and the segment audio cache for
 * BOTH the player (live playback) and the downloader (whole-message fetch):
 *
 *  - up to `maxInflight` (2) segments synthesize concurrently, so segment N+1
 *    is already in flight (or cached) while segment N plays — no gaps
 *  - chunks reach `onHeadChunk` strictly in segment order: the head segment
 *    streams live, later segments accumulate until they become head
 *  - backpressure: with > `lookaheadMs` of audio buffered ahead of the
 *    playhead, no NEW synthesis starts (bounded waste when the user stops
 *    early; the download mode probes 0 and is never throttled)
 *  - one retry per segment before failing the whole playback
 *  - every completed segment mp3 is written to the shared cache and reused
 *    on hit — replays cost nothing
 */

import type { TTSRequest } from '../../../shared/protocol';
import { safePortDisconnect } from '../../../shared/chrome-helpers';
import type { TTSSynthVoice } from '../../../shared/tts-params';
import { DEFAULT_TTS_RESOURCE_ID, DEFAULT_TTS_SPEAKER } from '../../../shared/tts-params';
import { ttsCacheKey, getCachedSegmentAudio, putSegmentAudio } from '../../../shared/tts-cache';
import { openTTSPort } from '../../../platform/ports';
import { readSettings } from '../../../platform/settings';

export interface TTSEngineOptions {
  /** Voice settings (key namespace for the cache). */
  voice: Promise<TTSSynthVoice>;
  /** Concurrent synthesis requests per engine (default 2). */
  maxInflight?: number;
  /** Stop dispatching new syntheses beyond this much buffered audio (default 30s). */
  lookaheadMs?: number;
  /** Backpressure probe: ms of playable audio ahead of the playhead (null = unknown). */
  getBufferedAheadMs?: () => number | null;
  /** Ordered audio bytes — live for the head segment, flushed for the rest. */
  onHeadChunk: (bytes: ArrayBuffer) => void;
  /** All enqueued segments fully appended AND input ended — safe to endOfStream. */
  onDrained: () => void;
  /** Unrecoverable failure (retry exhausted) — caller should stop everything. */
  onError: (message: string) => void;
}

type SegState = 'pending' | 'synthesizing' | 'ready' | 'appended';

interface Segment {
  text: string;
  state: SegState;
  retries: number;
  /** Accumulated bytes — for cache write and (when not streamed live) ordered flush. */
  bytes: ArrayBuffer[];
  byteLen: number;
  /** True once bytes have been forwarded to onHeadChunk while being the head. */
  streamedLive: boolean;
  port: chrome.runtime.Port | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const RETRY_DELAY_MS = 300;
/**
 * Appends are sliced to this size so every appendBuffer call looks like a
 * live SSE chunk — a cached segment's whole-blob append (hundreds of KB at
 * once) makes Chrome's mp3 timeline re-estimate while the playhead sits near
 * the append frontier, which audibly skips forward (first-play jump).
 */
const MAX_APPEND_BYTES = 32 * 1024;

export class TTSSynthEngine {
  private readonly opts: Required<Pick<TTSEngineOptions, 'maxInflight' | 'lookaheadMs' | 'getBufferedAheadMs'>> & TTSEngineOptions;
  private segs: Segment[] = [];
  private inflight = 0;
  private headIdx = 0;
  private inputEnded = false;
  private aborted = false;
  private drainedFired = false;

  constructor(opts: TTSEngineOptions) {
    this.opts = {
      maxInflight: 2,
      lookaheadMs: 30_000,
      getBufferedAheadMs: () => null,
      ...opts,
    };
  }

  /** Finalize one segment's (already stripped) text. */
  enqueue(text: string): void {
    if (this.aborted || this.inputEnded) return;
    const t = text.trim();
    if (!t) return;
    this.segs.push({ text: t, state: 'pending', retries: 0, bytes: [], byteLen: 0, streamedLive: false, port: null, timer: null });
    this.maybeDispatch();
  }

  /** No more text will arrive — enables onDrained once everything is appended. */
  endInput(): void {
    if (this.aborted) return;
    this.inputEnded = true;
    this.maybeDispatch();
    this.checkDrained();
  }

  /** Playback advanced (timeupdate / append) — re-evaluate backpressure. */
  notifyProgress(): void {
    if (!this.aborted) this.maybeDispatch();
  }

  /** Full stop: close ports, cancel retries. No callbacks fire afterwards. */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const s of this.segs) {
      if (s.timer) clearTimeout(s.timer);
      safePortDisconnect(s.port);
    }
    this.segs = [];
    this.inflight = 0;
  }

  // --- dispatch -------------------------------------------------------------

  private maybeDispatch(): void {
    if (this.aborted) return;
    const ahead = this.opts.getBufferedAheadMs();
    const throttled = ahead != null && ahead > this.opts.lookaheadMs;
    if (throttled) return;
    for (const s of this.segs) {
      if (this.inflight >= this.opts.maxInflight) return;
      if (s.state !== 'pending') continue;
      void this.startSegment(s);
    }
  }

  private async startSegment(s: Segment): Promise<void> {
    s.state = 'synthesizing';
    this.inflight++;
    try {
      const voice = await this.opts.voice;
      if (this.aborted || s.state !== 'synthesizing') return;
      const key = await ttsCacheKey(voice, s.text);
      const cached = await getCachedSegmentAudio(key);
      if (this.aborted || s.state !== 'synthesizing') return;
      if (cached) {
        this.receiveBytes(s, await cached.arrayBuffer());
        this.finishSegment(s);
        return;
      }
      this.openSynthPort(s, key);
    } catch (e) {
      this.failSegment(s, e instanceof Error ? e.message : String(e));
    }
  }

  private openSynthPort(s: Segment, key: string): void {
    const port = openTTSPort();
    s.port = port;
    const stale = () => this.aborted || s.state !== 'synthesizing';

    port.onDisconnect.addListener(() => {
      if (stale()) return;
      s.port = null;
      this.failSegment(s, 'TTS connection closed');
    });
    port.onMessage.addListener((msg: { type: string; data?: string; error?: string }) => {
      if (stale()) return;
      if (msg.type === 'chunk' && msg.data) {
        this.receiveBytes(s, decodeBase64(msg.data));
      } else if (msg.type === 'done') {
        // Cache the complete segment mp3 (Blob snapshots the bytes synchronously).
        if (s.byteLen > 0) void putSegmentAudio(key, new Blob(s.bytes, { type: 'audio/mpeg' }));
        s.port = null;
        this.finishSegment(s); // state → ready: any late events are stale
        safePortDisconnect(port);
      } else if (msg.type === 'error') {
        s.port = null;
        safePortDisconnect(port);
        this.failSegment(s, msg.error || 'TTS synthesis failed');
      }
    });
    port.postMessage({ type: 'tts', text: s.text } satisfies TTSRequest);
  }

  // --- bytes / ordering -------------------------------------------------------

  private receiveBytes(s: Segment, chunk: ArrayBuffer): void {
    for (let off = 0; off < chunk.byteLength; off += MAX_APPEND_BYTES) {
      const piece = chunk.slice(off, Math.min(off + MAX_APPEND_BYTES, chunk.byteLength));
      s.bytes.push(piece);
      s.byteLen += piece.byteLength;
      if (this.segs.indexOf(s) === this.headIdx) {
        // The head streams live; every later byte of it does too (the head only
        // changes once this segment completes). Non-head segments accumulate.
        s.streamedLive = true;
        this.opts.onHeadChunk(piece);
      }
    }
  }

  private finishSegment(s: Segment): void {
    s.state = 'ready';
    this.inflight--;
    this.drain();
    this.maybeDispatch();
    this.checkDrained();
  }

  /** Advance the head: flush accumulated bytes of ready segments, in order. */
  private drain(): void {
    while (this.headIdx < this.segs.length) {
      const s = this.segs[this.headIdx];
      if (!s || s.state !== 'ready') break;
      if (!s.streamedLive) for (const b of s.bytes) this.opts.onHeadChunk(b);
      s.bytes = []; // appended (or streamed live) — the cache holds the copy
      s.state = 'appended';
      this.headIdx++;
    }
  }

  private checkDrained(): void {
    if (this.drainedFired || this.aborted) return;
    if (this.inputEnded && this.headIdx >= this.segs.length) {
      this.drainedFired = true;
      this.opts.onDrained();
    }
  }

  // --- failures ----------------------------------------------------------------

  private failSegment(s: Segment, message: string): void {
    safePortDisconnect(s.port);
    s.port = null;
    if (this.aborted) return;
    this.inflight--;
    // Retry only when nothing ever reached the output: a partially streamed
    // segment cannot be resumed (TTS output is not reproducible byte-for-byte).
    if (s.retries < 1 && !s.streamedLive) {
      s.retries++;
      s.state = 'pending';
      s.bytes = [];
      s.byteLen = 0;
      this.maybeDispatch();
      s.timer = setTimeout(() => {
        s.timer = null;
        if (!this.aborted && s.state === 'pending') void this.startSegment(s);
      }, RETRY_DELAY_MS);
      return;
    }
    this.abort();
    this.opts.onError(message);
  }
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

/** Read the voice-defining settings with the SW's defaults as fallback. */
export function getTTSVoice(): Promise<TTSSynthVoice> {
  return readSettings(['ttsSpeaker', 'ttsResourceId'])
    .then(s => ({
      speaker: s.ttsSpeaker || DEFAULT_TTS_SPEAKER,
      resourceId: s.ttsResourceId || DEFAULT_TTS_RESOURCE_ID,
    }))
    .catch(() => ({ speaker: DEFAULT_TTS_SPEAKER, resourceId: DEFAULT_TTS_RESOURCE_ID }));
}
