// tts/player.js — Streaming TTS playback via MediaSource

import { stripMarkdown, SENTENCE_ENDS } from './utils.js';

let _chatArea;
let _fullStopFn = null;

let ttsPort = null;
let ttsPlaying = false;
let ttsDone = false;
let ttsMediaSource = null;
let ttsSourceBuffer = null;
let ttsAudioEl = null;
let ttsChunkQueue = [];
let ttsBufferAppending = false;

let ttsSentenceQueue = [];
let ttsTextBuffer = '';
let ttsSending = false;
let ttsSentenceCount = 0;

let ttsAutoPlayEnabled = false;

export function initPlayer(chatArea) {
  _chatArea = chatArea;
}

export function setFullStopFn(fn) {
  _fullStopFn = fn;
}

export function setTTSAutoPlay(val) {
  ttsAutoPlayEnabled = val;
}

export function isTTSAutoPlay() { return ttsAutoPlayEnabled; }
export function isTTSPlaying() { return ttsPlaying; }

export function stopTTSPlayback() {
  ttsPlaying = false;
  ttsDone = true;
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
    try { if (ttsMediaSource.readyState === 'open') ttsMediaSource.endOfStream(); } catch {}
    ttsMediaSource = null;
    ttsSourceBuffer = null;
  }
  if (ttsPort) {
    try { ttsPort.disconnect(); } catch {}
    ttsPort = null;
  }
}

export function initTTSPlayback() {
  ttsPlaying = true;
  ttsDone = false;
  ttsSentenceQueue = [];
  ttsTextBuffer = '';
  ttsSentenceCount = 0;
  ttsSending = false;
  ttsChunkQueue = [];
  ttsBufferAppending = false;

  const updateBtnState = (removeCls, addCls) => {
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

export function ttsEnqueue(text) {
  const cleaned = stripMarkdown(text);
  if (!cleaned) return;
  ttsSentenceQueue.push(cleaned);
  ttsFlush();
}

function ttsFlush() {
  if (ttsSending || ttsSentenceQueue.length === 0 || !ttsPlaying) return;
  if (!ttsSourceBuffer) return;

  ttsSending = true;
  const sentence = ttsSentenceQueue.shift();

  if (ttsPort) { try { ttsPort.disconnect(); } catch {} }

  ttsPort = chrome.runtime.connect({ name: 'tts' });

  ttsPort.onDisconnect.addListener(() => {
    if (ttsPlaying && _fullStopFn) _fullStopFn();
  });

  ttsPort.onMessage.addListener((msg) => {
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
      try { ttsPort.disconnect(); } catch {}
      ttsPort = null;

      if (ttsSentenceQueue.length > 0) {
        ttsFlush();
      } else {
        ttsDone = true;
        const finish = () => {
          if (ttsSourceBuffer && !ttsBufferAppending) {
            try { ttsMediaSource.endOfStream(); } catch {}
          }
        };
        if (ttsBufferAppending) {
          const handler = () => { finish(); ttsSourceBuffer.removeEventListener('updateend', handler); };
          ttsSourceBuffer.addEventListener('updateend', handler);
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

function ttsAppendNext() {
  if (!ttsSourceBuffer || ttsBufferAppending || ttsChunkQueue.length === 0) return;
  ttsBufferAppending = true;
  const chunk = ttsChunkQueue.shift();
  try {
    ttsSourceBuffer.appendBuffer(chunk);
  } catch (e) {
    console.error('[TTS] appendBuffer error:', e);
    ttsBufferAppending = false;
  }
}

/**
 * AI chunk 到来时调用，追加缓冲区 + 计数 + 入队
 */
export function ttsAppendChunk(content) {
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

/**
 * AI done 时调用，把缓冲区剩余文本入队
 */
export function ttsFlushRemaining() {
  if (!ttsPlaying) return;

  if (ttsTextBuffer.trim()) {
    ttsEnqueue(ttsTextBuffer.trim());
    ttsTextBuffer = '';
    ttsSentenceCount = 0;
  }

  if (ttsSentenceQueue.length === 0 && !ttsSending) {
    const finish = () => {
      if (ttsSourceBuffer && !ttsBufferAppending) {
        try { ttsMediaSource.endOfStream(); } catch {}
      }
    };
    if (ttsBufferAppending) {
      const handler = () => { finish(); ttsSourceBuffer.removeEventListener('updateend', handler); };
      ttsSourceBuffer.addEventListener('updateend', handler);
    } else {
      finish();
    }
  }
}
