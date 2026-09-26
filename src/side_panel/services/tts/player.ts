import { stripMarkdown, SENTENCE_ENDS } from './utils';
import { safePortDisconnect, safeEndOfStream } from '../../../shared/chrome-helpers';
import { openTTSPort } from '../../../platform/ports';

let _fullStopFn: (() => void) | null = null;

let ttsPort: chrome.runtime.Port | null = null;
let ttsPlaying = false;
let ttsMediaSource: MediaSource | null = null;
let ttsSourceBuffer: SourceBuffer | null = null;
let ttsAudioEl: HTMLAudioElement | null = null;
let ttsChunkQueue: ArrayBuffer[] = [];
let ttsBufferAppending = false;

let ttsSentenceQueue: string[] = [];
let ttsTextBuffer = '';
let ttsSending = false;
let ttsSentenceCount = 0;

let ttsAutoPlayEnabled = false;

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

export function stopTTSPlayback(): void {
  const wasPlaying = ttsPlaying;
  ttsPlaying = false;
  ttsSentenceQueue = [];
  ttsTextBuffer = '';
  ttsSentenceCount = 0;
  ttsSending = false;
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
  safePortDisconnect(ttsPort);
  ttsPort = null;
  if (wasPlaying) notifyTTSState();
}

export function initTTSPlayback(btn: Element | null = null, origin?: Partial<TTSOrigin>): void {
  // Single takeover point: starting a playback claims the one audio
  // resource. Any previous playback is fully stopped — its (possibly
  // detached) Audio element would otherwise keep playing forever.
  if (ttsPlaying) _fullStopFn?.();

  ttsPlaying = true;
  _audioStarted = false;
  ttsSentenceQueue = [];
  ttsTextBuffer = '';
  ttsSentenceCount = 0;
  ttsSending = false;
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

  const ms = new MediaSource();
  ttsMediaSource = ms;
  ttsAudioEl = new Audio();
  ttsAudioEl.src = URL.createObjectURL(ms);

  let started = false;

  ms.addEventListener('sourceopen', () => {
    if (ttsMediaSource !== ms) return;
    if (ms.sourceBuffers.length > 0) return;

    ttsSourceBuffer = ms.addSourceBuffer('audio/mpeg');
    ttsSourceBuffer.addEventListener('updateend', () => {
      ttsBufferAppending = false;
      if (!ttsSourceBuffer) return;
      if (!started && ttsAudioEl && ttsSourceBuffer.buffered.length > 0) {
        started = true;
        ttsAudioEl.play().then(() => {
        _audioStarted = true;
        updateBtnState(['tts-loading'], ['tts-playing']);
        notifyTTSState();
        }).catch(() => {});
      }
      ttsAppendNext();
    });

    ttsFlush();
  });

  ttsAudioEl.addEventListener('ended', () => {
    if (_fullStopFn) _fullStopFn();
  });
}

export function ttsEnqueue(text: string): void {
  const cleaned = stripMarkdown(text);
  if (!cleaned) return;
  ttsSentenceQueue.push(cleaned);
  ttsFlush();
}

function ttsFlush(): void {
  if (ttsSending || ttsSentenceQueue.length === 0 || !ttsPlaying) return;
  if (!ttsSourceBuffer) return;

  ttsSending = true;
  const sentence = ttsSentenceQueue.shift()!;

  safePortDisconnect(ttsPort);

  ttsPort = openTTSPort();

  ttsPort.onDisconnect.addListener(() => {
    if (ttsPlaying && _fullStopFn) _fullStopFn();
  });

  ttsPort.onMessage.addListener((msg: { type: string; data?: string; error?: string }) => {
    if (msg.type === 'chunk') {
      if (!msg.data) return;
      const binaryStr = atob(msg.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      ttsChunkQueue.push(bytes.buffer);
      ttsAppendNext();

    } else if (msg.type === 'done') {
      ttsSending = false;
      safePortDisconnect(ttsPort);
      ttsPort = null;

      if (ttsSentenceQueue.length > 0) {
        ttsFlush();
      } else {
        const finish = () => {
          if (ttsSourceBuffer && !ttsBufferAppending) {
            safeEndOfStream(ttsMediaSource);
          }
        };
        if (ttsBufferAppending) {
          const handler = () => { finish(); ttsSourceBuffer?.removeEventListener('updateend', handler); };
          ttsSourceBuffer?.addEventListener('updateend', handler);
        } else {
          finish();
        }
      }

    } else if (msg.type === 'error') {
      console.error('[TTS] error:', msg.error);
      if (_fullStopFn) _fullStopFn();
    }
  });

  ttsPort.postMessage({ type: 'tts', text: sentence });
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

export function ttsAppendChunk(content: string): void {
  if (!ttsPlaying || !ttsAutoPlayEnabled) return;

  ttsTextBuffer += content;

  for (let i = 0; i < content.length; i++) {
    if (SENTENCE_ENDS.includes(content[i])) {
      ttsSentenceCount++;
    }
  }

  while (ttsSentenceCount >= 2) {
    let found = 0;
    let cutPos = -1;
    for (let i = 0; i < ttsTextBuffer.length; i++) {
      if (SENTENCE_ENDS.includes(ttsTextBuffer[i])) {
        found++;
        if (found >= 2) {
          cutPos = i + 1;
          break;
        }
      }
    }

    if (cutPos === -1) break;

    const segment = ttsTextBuffer.slice(0, cutPos);
    ttsTextBuffer = ttsTextBuffer.slice(cutPos);
    ttsSentenceCount -= 2;
    ttsEnqueue(segment);
  }
}

export function ttsFlushRemaining(): void {
  if (!ttsPlaying) return;

  if (ttsTextBuffer.trim()) {
    ttsEnqueue(ttsTextBuffer.trim());
    ttsTextBuffer = '';
    ttsSentenceCount = 0;
  }

  if (ttsSentenceQueue.length === 0 && !ttsSending) {
    const finish = () => {
      if (ttsSourceBuffer && !ttsBufferAppending) {
        safeEndOfStream(ttsMediaSource);
      }
    };
    if (ttsBufferAppending) {
      const handler = () => { finish(); ttsSourceBuffer?.removeEventListener('updateend', handler); };
      ttsSourceBuffer?.addEventListener('updateend', handler);
    } else {
      finish();
    }
  }
}
