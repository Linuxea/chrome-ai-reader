import { createSegmentStream } from './utils';
import { safeEndOfStream } from '../../../shared/chrome-helpers';
import { TTSSynthEngine, getTTSVoice } from './engine';

let _fullStopFn: (() => void) | null = null;

let ttsEngine: TTSSynthEngine | null = null;
let ttsSegmentStream: ReturnType<typeof createSegmentStream> | null = null;
let ttsPlaying = false;
let ttsMediaSource: MediaSource | null = null;
let ttsSourceBuffer: SourceBuffer | null = null;
let ttsAudioEl: HTMLAudioElement | null = null;
let ttsChunkQueue: ArrayBuffer[] = [];
let ttsBufferAppending = false;

let ttsAutoPlayEnabled = false;

/** Playback-rate cycle offered by the global indicator (persisted as ttsSpeed). */
export const TTS_SPEED_STEPS = [1, 1.25, 1.5, 2] as const;
let _playbackRate = 1;

/** Trim played-out buffer once the playhead is this far ahead of it. */
const TRIM_BEHIND_MS = 60_000;
/** …but always keep the last 10s behind the playhead (seek safety). */
const TRIM_KEEP_S = 10;
/**
 * Don't start playback on the first sliver of audio: keep the playhead this
 * far behind the append frontier. Appending/sealing while the playhead sits
 * ON the frontier makes Chrome's mp3 timeline snap forward (first-play jump
 * to the next segment). Shorter messages start once the stream is sealed.
 */
const START_CUSHION_S = 2.5;

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
  /** Audio actually started (vs waiting for the first chunk). */
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
  /** Playhead seconds. */
  position: number;
  /** End of buffered audio seconds (MSE streams have no finite duration). */
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
  const b = ttsSourceBuffer?.buffered;
  if (!ttsAudioEl || !b || typeof b.end !== 'function' || b.length === 0) return null;
  const end = b.end(b.length - 1);
  if (!Number.isFinite(end)) return null;
  return { position: ttsAudioEl.currentTime || 0, end };
}

export function isTTSAudioStarted(): boolean { return _audioStarted; }

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

/** Apply now (if playing) and to every future playback (persisted by the caller). */
export function setTTSPlaybackRate(rate: number): void {
  _playbackRate = rate;
  if (ttsAudioEl) ttsAudioEl.playbackRate = rate;
}

export function getTTSPlaybackRate(): number { return _playbackRate; }

export function stopTTSPlayback(): void {
  const wasPlaying = ttsPlaying;
  ttsPlaying = false;
  ttsEngine?.abort();
  ttsEngine = null;
  ttsSegmentStream = null;
  ttsChunkQueue = [];
  ttsBufferAppending = false;
  _originTabId = null;
  _originMsgId = null;

  if (ttsAudioEl) {
    ttsAudioEl.pause();
    ttsAudioEl.src = '';
    ttsAudioEl = null;
  }
  if (ttsMediaSource) {
    safeEndOfStream(ttsMediaSource);
    ttsMediaSource = null;
    ttsSourceBuffer = null;
  }
  if (wasPlaying) notifyTTSState();
}

export function initTTSPlayback(btn: Element | null = null, origin?: Partial<TTSOrigin>): void {
  // Single takeover point: starting a playback claims the one audio
  // resource. Any previous playback is fully stopped — its (possibly
  // detached) Audio element would otherwise keep playing forever.
  if (ttsPlaying) _fullStopFn?.();

  ttsPlaying = true;
  _audioStarted = false;
  ttsChunkQueue = [];
  ttsBufferAppending = false;
  _originTabId = null;
  _originMsgId = null;
  if (origin) setTTSOrigin(origin);

  setTTSButton(btn);
  notifyTTSState();
  const updateBtnState = (removeCls: string[] | null, addCls: string[] | null) => {
    if (_playBtn) {
      if (removeCls) _playBtn.classList.remove(...removeCls);
      if (addCls) _playBtn.classList.add(...addCls);
    }
  };

  const bufferedAheadMs = (): number | null => {
    const b = ttsSourceBuffer?.buffered;
    if (!ttsAudioEl || !b || typeof b.end !== 'function' || b.length === 0) return null;
    const ahead = b.end(b.length - 1) - ttsAudioEl.currentTime;
    return Number.isFinite(ahead) ? ahead * 1000 : null;
  };

  /** Engine drained: everything appended and input ended → finish the stream. */
  const finishStream = () => {
    const finish = () => {
      if (ttsSourceBuffer && !ttsBufferAppending) {
        safeEndOfStream(ttsMediaSource);
      }
      // The buffer can no longer grow: a short message that never reached
      // the cushion must still start (sealed = start regardless of cushion).
      sealed = true;
      tryStart();
      if (!started && ttsChunkQueue.length === 0 && !ttsBufferAppending) {
        // Nothing was ever synthesized (e.g. an answer that is all code block):
        // don't leave a zombie "loading" state — stop cleanly.
        _fullStopFn?.();
        return;
      }
    };
    if (ttsBufferAppending) {
      const handler = () => { finish(); ttsSourceBuffer?.removeEventListener('updateend', handler); };
      ttsSourceBuffer?.addEventListener('updateend', handler);
    } else {
      finish();
    }
  };

  /** Start once enough audio is buffered (or the sealed stream is all we'll get). */
  const tryStart = () => {
    if (started || !ttsAudioEl || !ttsSourceBuffer) return;
    const b = ttsSourceBuffer.buffered;
    if (!b || b.length === 0) return;
    const end = typeof b.end === 'function' ? b.end(b.length - 1) : 0;
    if (!sealed && end - (ttsAudioEl.currentTime || 0) < START_CUSHION_S) return;
    started = true;
    ttsAudioEl.play().then(() => {
      _audioStarted = true;
      updateBtnState(['tts-loading'], ['tts-playing']);
      notifyTTSState();
    }).catch(() => {});
  };

  let started = false;
  let sealed = false;

  ttsEngine = new TTSSynthEngine({
    voice: getTTSVoice(),
    getBufferedAheadMs: bufferedAheadMs,
    onHeadChunk: (bytes) => {
      ttsChunkQueue.push(bytes);
      ttsAppendNext();
    },
    onDrained: finishStream,
    onError: (msg) => {
      console.error('[TTS] error:', msg);
      if (_fullStopFn) _fullStopFn();
    },
  });
  ttsSegmentStream = createSegmentStream();

  const ms = new MediaSource();
  ttsMediaSource = ms;
  ttsAudioEl = new Audio();
  ttsAudioEl.src = URL.createObjectURL(ms);
  ttsAudioEl.playbackRate = _playbackRate;
  ttsAudioEl.addEventListener('timeupdate', () => {
    trimSourceBuffer();
    ttsEngine?.notifyProgress();
    notifyProgress();
  });

  ms.addEventListener('sourceopen', () => {
    if (ttsMediaSource !== ms) return;
    if (ms.sourceBuffers.length > 0) return;

    ttsSourceBuffer = ms.addSourceBuffer('audio/mpeg');
    // mp3 carries no timestamps — force contiguous placement of every append.
    try { ttsSourceBuffer.mode = 'sequence'; } catch { /* already updating — default is sequence for raw mp3 */ }
    ttsSourceBuffer.addEventListener('updateend', () => {
      ttsBufferAppending = false;
      if (!ttsSourceBuffer) return;
      tryStart();
      ttsAppendNext();
      // Buffered-ahead grew (or drained): re-evaluate backpressure + progress.
      ttsEngine?.notifyProgress();
      notifyProgress();
    });

    ttsAppendNext(); // feed anything that arrived before the buffer existed
    ttsEngine?.notifyProgress();
  });

  ttsAudioEl.addEventListener('ended', () => {
    if (_fullStopFn) _fullStopFn();
  });
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

function ttsAppendNext(): void {
  if (!ttsSourceBuffer || ttsBufferAppending || ttsChunkQueue.length === 0) return;
  ttsBufferAppending = true;
  const chunk = ttsChunkQueue.shift()!;
  try {
    ttsSourceBuffer.appendBuffer(chunk);
  } catch (e) {
    console.error('[TTS] appendBuffer error:', e);
    ttsBufferAppending = false;
  }
}

/** Keep hour-long reads flat in memory: drop played-out buffer behind the playhead. */
function trimSourceBuffer(): void {
  const sb = ttsSourceBuffer;
  const el = ttsAudioEl;
  if (!sb || !el || sb.updating) return;
  const b = sb.buffered;
  if (!b || typeof b.start !== 'function' || b.length === 0) return;
  if (typeof sb.remove !== 'function') return;
  const start = b.start(0);
  if (el.currentTime - start > TRIM_BEHIND_MS / 1000) {
    try {
      sb.remove(start, Math.max(start, el.currentTime - TRIM_KEEP_S));
    } catch { /* raced with an append — next timeupdate retries */ }
  }
}
