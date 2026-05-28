import { stripMarkdown, SENTENCE_ENDS } from './utils';
import { safePortDisconnect, safeEndOfStream } from '../../../shared/chrome-helpers';

let _chatArea: HTMLElement;
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

export function initPlayer(chatArea: HTMLElement): void {
  _chatArea = chatArea;
}

export function setFullStopFn(fn: (() => void) | null): void {
  _fullStopFn = fn;
}

export function setTTSAutoPlay(val: boolean): void {
  ttsAutoPlayEnabled = val;
}

export function isTTSAutoPlay(): boolean { return ttsAutoPlayEnabled; }
export function isTTSPlaying(): boolean { return ttsPlaying; }

export function stopTTSPlayback(): void {
  ttsPlaying = false;
  ttsSentenceQueue = [];
  ttsTextBuffer = '';
  ttsSentenceCount = 0;
  ttsSending = false;
  ttsChunkQueue = [];
  ttsBufferAppending = false;

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
}

export function initTTSPlayback(): void {
  ttsPlaying = true;
  ttsSentenceQueue = [];
  ttsTextBuffer = '';
  ttsSentenceCount = 0;
  ttsSending = false;
  ttsChunkQueue = [];
  ttsBufferAppending = false;

  const updateBtnState = (removeCls: string[] | null, addCls: string[] | null) => {
    const btn = _chatArea.querySelector('.tts-btn');
    if (btn) {
      if (removeCls) btn.classList.remove(...removeCls);
      if (addCls) btn.classList.add(...addCls);
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
          updateBtnState(['tts-loading'], ['tts-playing']);
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

  ttsPort = chrome.runtime.connect({ name: 'tts' });

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
