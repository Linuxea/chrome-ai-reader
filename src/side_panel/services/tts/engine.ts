/**
 * Pipelined TTS synthesis engine.
 *
 * Owns ports, ordering, backpressure, retries and the segment audio cache for
 * BOTH the player (live playback) and the downloader (whole-message fetch):
 *
 *  - up to `maxInflight` (2) segments synthesize concurrently, so segment N+1
 *    is already in flight (or cached) while segment N plays — no gaps
 *  - completed segments are delivered strictly in order via `onSegmentAudio`
 *    (each payload is ONE segment's complete mp3 — the consumer decodes it
 *    independently; concatenated mp3s on a shared MediaSource timeline jump
 *    when a later file's headers force a timeline repair under the playhead)
 *  - backpressure: with > `lookaheadMs` of playable audio ahead of the
 *    playhead, no NEW synthesis starts (bounded waste when the user stops
 *    early; the download mode probes 0 and is never throttled)
 *  - one retry per segment before failing the whole playback (always safe:
 *    nothing is delivered before a segment completes)
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
  /** Stop dispatching new syntheses beyond this much playable audio (default 30s). */
  lookaheadMs?: number;
  /** Backpressure probe: ms of playable audio ahead of the playhead (null = unknown). */
  getBufferedAheadMs?: () => number | null;
  /** Completed segments' mp3, delivered strictly in order (empty ones skipped). */
  onSegmentAudio: (bytes: ArrayBuffer) => void;
  /** All segments delivered AND input ended — nothing more will arrive. */
  onDrained: () => void;
  /** Unrecoverable failure (retry exhausted) — caller should stop everything. */
  onError: (message: string) => void;
}

type SegState = 'pending' | 'synthesizing' | 'ready' | 'delivered';

interface Segment {
  text: string;
  state: SegState;
  retries: number;
  /** Accumulated mp3 bytes of the in-flight segment (joined on delivery). */
  bytes: ArrayBuffer[];
  byteLen: number;
  port: chrome.runtime.Port | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const RETRY_DELAY_MS = 300;

export class TTSSynthEngine {
  private readonly opts: Required<Pick<TTSEngineOptions, 'maxInflight' | 'lookaheadMs' | 'getBufferedAheadMs'>> & TTSEngineOptions;
  private segs: Segment[] = [];
  private inflight = 0;
  private nextDeliver = 0;
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
    this.segs.push({ text: t, state: 'pending', retries: 0, bytes: [], byteLen: 0, port: null, timer: null });
    this.maybeDispatch();
  }

  /** No more text will arrive — enables onDrained once everything is delivered. */
  endInput(): void {
    if (this.aborted) return;
    this.inputEnded = true;
    this.maybeDispatch();
    this.checkDrained();
  }

  /** Playback advanced — re-evaluate backpressure. */
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
    if (ahead != null && ahead > this.opts.lookaheadMs) return;
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
        s.bytes = [await cached.arrayBuffer()];
        s.byteLen = s.bytes[0].byteLength;
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
        s.bytes.push(decodeBase64(msg.data));
        s.byteLen = s.bytes.reduce((n, b) => n + b.byteLength, 0);
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

  // --- ordered delivery -------------------------------------------------------

  private finishSegment(s: Segment): void {
    s.state = 'ready';
    this.inflight--;
    this.deliverReady();
    this.maybeDispatch();
    this.checkDrained();
  }

  /** Deliver completed segments strictly in order, as one mp3 each. */
  private deliverReady(): void {
    while (this.nextDeliver < this.segs.length && this.segs[this.nextDeliver].state === 'ready') {
      const s = this.segs[this.nextDeliver];
      if (s.byteLen > 0) this.opts.onSegmentAudio(concatBytes(s.bytes));
      s.bytes = [];
      s.state = 'delivered';
      this.nextDeliver++;
    }
  }

  private checkDrained(): void {
    if (this.drainedFired || this.aborted) return;
    if (this.inputEnded && this.nextDeliver >= this.segs.length) {
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
    // Safe to retry: nothing is delivered before a segment completes.
    if (s.retries < 1) {
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

function concatBytes(pieces: ArrayBuffer[]): ArrayBuffer {
  const total = pieces.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of pieces) {
    out.set(new Uint8Array(b), off);
    off += b.byteLength;
  }
  return out.buffer as ArrayBuffer;
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
