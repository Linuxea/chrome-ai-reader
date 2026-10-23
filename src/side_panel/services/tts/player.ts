import { createSegmentStream } from './utils';
import { TTSSynthEngine, getTTSVoice } from './engine';

let _fullStopFn: (() => void) | null = null;

let ttsEngine: TTSSynthEngine | null = null;
let ttsSegmentStream: ReturnType<typeof createSegmentStream> | null = null;
let ttsPlaying = false;

let ttsAutoPlayEnabled = false;

/** Playback-rate cycle offered by the global indicator (persisted as ttsSpeed). */
export const TTS_SPEED_STEPS = [1, 1.25, 1.5, 2] as const;
let _rate = 1;

// --- WebAudio sink ------------------------------------------------------------
//
// Each segment's mp3 is decoded independently (decodeAudioData) and scheduled
// sample-accurately back-to-back with AudioBufferSourceNodes. This replaces
// the old MediaSource pipeline: appending several separately-encoded mp3 files
// into ONE MSE timeline made Chrome repair the timeline under the playhead
// when a later file arrived (first-play "jump to the next segment" bug).
// Independent decoding has no shared timeline to repair — a jump is impossible.

let _ctx: AudioContext | null = null;
/** Maps buffer-time ⇄ context-time at the current rate; recreated on rate change. */
let _anchor: { ctxTime: number; bufTime: number; rate: number } | null = null;
interface SegEntry {
  /** Buffer-time start (assigned when scheduled). */
  start: number;
  duration: number;
  buffer: AudioBuffer | null;
  scheduled: boolean;
}
let _segs: SegEntry[] = [];
let _nextSched = 0;
/** Buffer-time end of everything scheduled so far. */
let _schedEndBuf = 0;
let _liveSources = new Set<AudioBufferSourceNode>();
let _drainedAll = false;
/** Segments whose decodeAudioData is still pending (not yet in _segs). */
let _decoding = 0;
let _tick: ReturnType<typeof setInterval> | null = null;

/** The TTS button of the message being read — its state tracks this playback. */
let _playBtn: Element | null = null;
let _audioStarted = false;

// --- Window-global playback identity ---------------------------------------

/**
 * Which tab / message this playback belongs to. TTS is a window-global
 * "printer resource": it keeps reading across tab switches; the origin
 * anchors let the chat-area rebuild re-attach the button state when the
 * user returns to the originating tab (mirrors the podcast's now-playing).
 */
export interface TTSOrigin {
  tabId: number | null;
  msgId: string | null;
}

let _originTabId: number | null = null;
let _originMsgId: string | null = null;

export function setTTSOrigin(origin: Partial<TTSOrigin>): void {
  if (origin.tabId !== undefined) _originTabId = origin.tabId;
  if (origin.msgId !== undefined) _originMsgId = origin.msgId;
}

export function getTTSOrigin(): TTSOrigin {
  return { tabId: _originTabId, msgId: _originMsgId };
}

export interface TTSPlaybackState {
  playing: boolean;
  /** Audio actually started (vs waiting for the first segment). */
  audioStarted: boolean;
}

type StateListener = (state: TTSPlaybackState) => void;
const _stateListeners = new Set<StateListener>();

/** Subscribe to playback lifecycle changes (drives the global indicator). */
export function subscribeTTSState(cb: StateListener): () => void {
  _stateListeners.add(cb);
  return () => { _stateListeners.delete(cb); };
}

function notifyTTSState(): void {
  const snapshot: TTSPlaybackState = { playing: ttsPlaying, audioStarted: _audioStarted };
  _stateListeners.forEach(cb => cb(snapshot));
}

// --- Playback progress (indicator m:ss / m:ss) --------------------------------

export interface TTSProgress {
  /** Playhead in buffer-seconds. */
  position: number;
  /** End of scheduled audio in buffer-seconds. */
  end: number;
}

type ProgressListener = (progress: TTSProgress) => void;
const _progressListeners = new Set<ProgressListener>();

export function subscribeTTSProgress(cb: ProgressListener): () => void {
  _progressListeners.add(cb);
  return () => { _progressListeners.delete(cb); };
}

function notifyProgress(): void {
  if (_progressListeners.size === 0) return;
  const p = currentProgress();
  if (p) _progressListeners.forEach(cb => cb(p));
}

export function currentProgress(): TTSProgress | null {
  if (!_anchor || _schedEndBuf <= 0) return null;
  return { position: currentBufPos(), end: _schedEndBuf };
}

/** Playhead in buffer-seconds (clamped to what has been scheduled). */
function currentBufPos(): number {
  if (!_anchor || !_ctx) return 0;
  const pos = _anchor.bufTime + (_ctx.currentTime - _anchor.ctxTime) * _anchor.rate;
  return Math.min(Math.max(pos, 0), _schedEndBuf);
}

export function isTTSAudioStarted(): boolean { return _audioStarted; }

function updateBtnState(removeCls: string[], addCls: string[]): void {
  if (!_playBtn) return;
  _playBtn.classList.remove(...removeCls);
  _playBtn.classList.add(...addCls);
}

/**
 * Tab switch / chat rebuild: the anchored bubble is about to be discarded —
 * drop the button reference so state updates stop targeting a dead element.
 * Audio keeps playing (the global indicator offers the stop control).
 */
export function detachTTSAnchor(): void {
  _playBtn = null;
}

export function getTTSButton(): Element | null { return _playBtn; }

/**
 * Attach the button of the message being read (autoplay starts before the
 * answer — and so its button — exists). Shows loading / playing on it.
 */
export function setTTSButton(btn: Element | null): void {
  _playBtn = btn;
  if (btn && ttsPlaying) btn.classList.add(_audioStarted ? 'tts-playing' : 'tts-loading');
}

/** Kept for the init contract; the player holds no chat-area reference. */
export function initPlayer(_chatArea: HTMLElement): void {}

export function setFullStopFn(fn: (() => void) | null): void {
  _fullStopFn = fn;
}

export function setTTSAutoPlay(val: boolean): void {
  ttsAutoPlayEnabled = val;
}

export function isTTSAutoPlay(): boolean { return ttsAutoPlayEnabled; }
export function isTTSPlaying(): boolean { return ttsPlaying; }

/** Apply now (if playing — rescheduling the unplayed audio) and to every future playback. */
export function setTTSPlaybackRate(rate: number): void {
  if (rate === _rate) return; // same rate: stopping/rescheduling would glitch
  _rate = rate;
  if (!ttsPlaying || !_ctx || !_anchor) return;

  const pos = currentBufPos();
  for (const src of _liveSources) {
    src.onended = null; // rate change, not playback end
    try { src.stop(); } catch { /* already stopped */ }
  }
  _liveSources.clear();
  _anchor = { ctxTime: _ctx.currentTime + 0.03, bufTime: pos, rate };

  // Re-create the unplayed remainder (partially played segments resume mid-buffer).
  for (const seg of _segs) {
    if (!seg.buffer || !seg.scheduled) continue;
    if (seg.start + seg.duration <= pos + 0.01) continue; // fully played out
    scheduleSource(seg, Math.max(0, pos - seg.start), seg.start);
  }
}

export function getTTSPlaybackRate(): number { return _rate; }

export function stopTTSPlayback(): void {
  const wasPlaying = ttsPlaying;
  ttsPlaying = false;
  ttsEngine?.abort();
  ttsEngine = null;
  ttsSegmentStream = null;
  _originTabId = null;
  _originMsgId = null;

  if (_tick) { clearInterval(_tick); _tick = null; }
  for (const src of _liveSources) {
    src.onended = null;
    try { src.stop(); } catch { /* already stopped */ }
  }
  _liveSources.clear();
  if (_ctx) {
    try { void _ctx.close(); } catch { /* already closed */ }
    _ctx = null;
  }
  _anchor = null;
  _segs = [];
  _nextSched = 0;
  _schedEndBuf = 0;
  _drainedAll = false;
  _decoding = 0;
  _audioStarted = false;

  if (wasPlaying) notifyTTSState();
}

function ensureCtx(): AudioContext {
  if (!_ctx) {
    _ctx = new AudioContext();
    // Autoplay defense: the panel page has prior user activation (the user
    // typed the question), so resume() succeeds; ignore transient failures.
    void _ctx.resume?.().catch(() => {});
  }
  return _ctx;
}

/** Schedule one source. `offset` resumes mid-buffer (rate change). */
function scheduleSource(seg: SegEntry, offset: number, startBuf: number): void {
  const ctx = _ctx!;
  const anchor = _anchor!;
  const src = ctx.createBufferSource();
  src.buffer = seg.buffer;
  src.playbackRate.value = anchor.rate;
  const when = anchor.ctxTime + (startBuf - anchor.bufTime) / anchor.rate;
  src.start(Math.max(when, ctx.currentTime), offset);
  src.onended = () => {
    _liveSources.delete(src);
    maybeFinished();
  };
  _liveSources.add(src);
}

/** Schedule every decoded-but-unscheduled segment, strictly in order. */
function pumpSchedule(updateBtnState: (removeCls: string[], addCls: string[]) => void): void {
  if (!ttsPlaying || !_ctx) return;
  while (_nextSched < _segs.length) {
    const seg = _segs[_nextSched];
    if (!seg.buffer) break; // earlier decode still pending
    if (!_anchor) _anchor = { ctxTime: _ctx.currentTime + 0.06, bufTime: 0, rate: _rate };
    seg.start = _schedEndBuf;
    scheduleSource(seg, 0, seg.start);
    seg.scheduled = true;
    _schedEndBuf += seg.duration;
    _nextSched++;
    if (!_audioStarted) {
      _audioStarted = true;
      updateBtnState(['tts-loading'], ['tts-playing']);
      notifyTTSState();
    }
  }
}

/** All delivered and nothing playing → playback finished. */
function maybeFinished(): void {
  if (!ttsPlaying || !_drainedAll) return;
  if (_decoding > 0) return; // the final segment(s) are still decoding
  if (_liveSources.size > 0) return;
  if (currentBufPos() < _schedEndBuf - 0.05) return; // rate change / not yet at the end
  _fullStopFn?.();
}

/** Free PCM of fully played segments (mp3 stays in the engine's disk cache). */
function prunePlayed(): void {
  const pos = currentBufPos();
  for (const seg of _segs) {
    if (seg.buffer && seg.start + seg.duration < pos - 5) seg.buffer = null;
  }
}

export function initTTSPlayback(btn: Element | null = null, origin?: Partial<TTSOrigin>): void {
  // Single takeover point: starting a playback claims the one audio
  // resource. Any previous playback is fully stopped — its context and
  // scheduled sources would otherwise keep playing forever.
  if (ttsPlaying) _fullStopFn?.();

  ttsPlaying = true;
  _audioStarted = false;
  _anchor = null;
  _segs = [];
  _nextSched = 0;
  _schedEndBuf = 0;
  _drainedAll = false;
  _originTabId = null;
  _originMsgId = null;
  if (origin) setTTSOrigin(origin);

  setTTSButton(btn);
  notifyTTSState();

  ttsEngine = new TTSSynthEngine({
    voice: getTTSVoice(),
    getBufferedAheadMs: () => {
      if (!ttsPlaying || !_anchor) return null;
      const ahead = _schedEndBuf - currentBufPos();
      return ahead > 0 ? ahead * 1000 : null;
    },
    onSegmentAudio: (bytes) => { void receiveSegment(bytes); },
    onDrained: () => {
      _drainedAll = true;
      maybeFinished(); // covers the zero-segment case (nothing to play) too
    },
    onError: (msg) => {
      console.error('[TTS] error:', msg);
      if (_fullStopFn) _fullStopFn();
    },
  });
  ttsSegmentStream = createSegmentStream();

  // WebAudio has no `timeupdate` — poll for progress/backpressure/pruning.
  _tick = setInterval(() => {
    if (!ttsPlaying) return;
    prunePlayed();
    ttsEngine?.notifyProgress();
    notifyProgress();
    maybeFinished();
  }, 250);
}

/** Decode one completed segment's mp3 independently and queue it for scheduling. */
async function receiveSegment(bytes: ArrayBuffer): Promise<void> {
  if (!ttsPlaying) return;
  _decoding++;
  try {
    let buffer: AudioBuffer;
    try {
      const ctx = ensureCtx();
      // decodeAudioData detaches its input; the engine's buffer is a fresh copy
      // per segment, slice anyway so a retry/decode quirk can't bite the caller.
      buffer = await ctx.decodeAudioData(bytes.slice(0));
    } catch (e) {
      // A single bad segment (transient stream corruption) skips — playback
      // continuity beats dying mid-message.
      console.error('[TTS] decode failed, skipping segment', e);
      return;
    }
    if (!ttsPlaying) return; // stopped while decoding
    _segs.push({ start: 0, duration: buffer.duration, buffer, scheduled: false });
    pumpSchedule(updateBtnState);
  } finally {
    _decoding--;
  }
}

/** Enqueue one finalized (already stripped) segment. */
export function ttsEnqueue(text: string): void {
  if (!ttsPlaying || !ttsEngine) return;
  ttsEngine.enqueue(text);
}

/**
 * Autoplay: feed a streaming answer delta. The segment stream strips and cuts
 * with the same prefix rule as the batch path, so cache keys stay identical.
 */
export function ttsAppendChunk(content: string): void {
  if (!ttsPlaying || !ttsAutoPlayEnabled) return;
  if (!ttsSegmentStream) return;
  for (const seg of ttsSegmentStream.push(content)) ttsEnqueue(seg);
}

/** Signal that no more text will arrive (button/download path). */
export function ttsFinishInput(): void {
  ttsEngine?.endInput();
}

/** Answer finished (autoplay): flush the tail segment and finish input. */
export function ttsFlushRemaining(): void {
  if (!ttsPlaying) return;

  const tail = ttsSegmentStream?.end() ?? null;
  ttsSegmentStream = null;
  if (tail) ttsEnqueue(tail);
  ttsFinishInput();
}
