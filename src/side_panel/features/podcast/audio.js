import { t } from '../../../shared/i18n.js';
import { downloadFile } from '../../../shared/download.js';
import { formatDuration } from '../../../shared/format.js';
import * as state from '../../state.js';
import { MAX_CHUNK_QUEUE_SIZE } from './constants.js';
import { updateTranscriptHighlight } from './ui.js';

let podcastPort = null;
let podcastAudioEl = null;
let podcastMediaSource = null;
let podcastSourceBuffer = null;
let podcastChunkQueue = [];
let podcastBufferAppending = false;
let podcastPlayTransitioning = false;
let podcastAudioChunks = [];
let _podcastTitle = '';
let _roundTimings = [];

let _showStatus = null;
let _resetPodcastState = null;
let _isCancelled = null;

export function initAudioCallbacks({ showStatus, resetPodcastState, isCancelled }) {
  _showStatus = showStatus;
  _resetPodcastState = resetPodcastState;
  _isCancelled = isCancelled;
}

export function setPodcastTitle(title) {
  _podcastTitle = title;
}

export function resetRoundTimings() {
  _roundTimings = [];
}

export function cleanupPodcastAudio() {
  if (podcastAudioEl) {
    podcastAudioEl.pause();
    podcastAudioEl.src = '';
    podcastAudioEl = null;
  }
  if (podcastMediaSource) {
    try { if (podcastMediaSource.readyState === 'open') podcastMediaSource.endOfStream(); } catch { /* cleanup — safe to ignore */ }
    podcastMediaSource = null;
    podcastSourceBuffer = null;
  }
  if (podcastPort) {
    try { podcastPort.disconnect(); } catch { /* cleanup — safe to ignore */ }
    podcastPort = null;
  }
  podcastChunkQueue = [];
  podcastAudioChunks = [];
  podcastBufferAppending = false;
  _podcastTitle = '';
  _roundTimings = [];
}

function initPodcastPlayback(card) {
  if (podcastAudioEl) {
    podcastAudioEl.pause();
    podcastAudioEl.src = '';
    podcastAudioEl = null;
  }
  if (podcastMediaSource) {
    try { if (podcastMediaSource.readyState === 'open') podcastMediaSource.endOfStream(); } catch { /* cleanup — safe to ignore */ }
    podcastMediaSource = null;
    podcastSourceBuffer = null;
  }
  podcastChunkQueue = [];
  podcastBufferAppending = false;

  const ms = new MediaSource();
  podcastMediaSource = ms;

  const audio = new Audio();
  audio.src = URL.createObjectURL(ms);
  podcastAudioEl = audio;

  ms.addEventListener('sourceopen', () => {
    if (podcastMediaSource !== ms) return;
    if (ms.sourceBuffers.length > 0) return;

    podcastSourceBuffer = ms.addSourceBuffer('audio/mpeg');
    podcastSourceBuffer.addEventListener('updateend', () => {
      podcastBufferAppending = false;
      if (podcastAudioEl && podcastAudioEl.paused && podcastSourceBuffer.buffered.length > 0) {
        podcastAudioEl.play().catch(() => {});
      }
      appendPodcastChunk();
    });
  });

  audio.addEventListener('timeupdate', () => {
    updatePlayerProgress(card);
  });

  audio.addEventListener('ended', () => {
    _showStatus(card, 'done');
  });

  _showStatus(card, 'playing');
}

function appendPodcastChunk() {
  if (!podcastSourceBuffer || podcastBufferAppending || podcastChunkQueue.length === 0) return;
  podcastBufferAppending = true;
  const chunk = podcastChunkQueue.shift();
  try {
    podcastSourceBuffer.appendBuffer(chunk);
  } catch (e) {
    console.error('[Podcast] appendBuffer error:', e);
    podcastBufferAppending = false;
  }
}

function updatePlayerProgress(card) {
  if (!podcastAudioEl) return;
  const fill = card.querySelector('.podcast-progress-fill');
  const thumb = card.querySelector('.podcast-progress-thumb');
  const timeEl = card.querySelector('.podcast-time');
  const playBtn = card.querySelector('.podcast-play-btn');

  if (podcastAudioEl.duration && isFinite(podcastAudioEl.duration)) {
    const pct = (podcastAudioEl.currentTime / podcastAudioEl.duration) * 100;
    if (fill) fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
    if (timeEl) {
      timeEl.textContent = `${formatDuration(podcastAudioEl.currentTime)} / ${formatDuration(podcastAudioEl.duration)}`;
    }
  }

  if (playBtn) {
    if (podcastAudioEl.paused) {
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      playBtn.title = t('podcast.play');
    } else {
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
      playBtn.title = t('podcast.pause');
    }
  }

  if (_roundTimings.length > 0 && !podcastAudioEl.paused) {
    const ct = podcastAudioEl.currentTime;
    let roundIdx = -1;
    for (let i = 0; i < _roundTimings.length; i++) {
      if (ct >= _roundTimings[i].startTime && ct < _roundTimings[i].endTime) {
        roundIdx = i;
        break;
      }
    }
    if (roundIdx === -1 && ct >= _roundTimings[_roundTimings.length - 1].endTime) {
      roundIdx = _roundTimings.length - 1;
    }
    updateTranscriptHighlight(roundIdx, card);
  }
}

function handlePlayPause() {
  if (!podcastAudioEl || podcastPlayTransitioning) return;

  podcastPlayTransitioning = true;
  setTimeout(() => { podcastPlayTransitioning = false; }, 300);

  if (podcastAudioEl.paused) {
    podcastAudioEl.play().catch(() => {});
  } else {
    podcastAudioEl.pause();
  }
}

function seekToMouse(e, card, bar) {
  if (!podcastAudioEl || !podcastAudioEl.duration || !isFinite(podcastAudioEl.duration)) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  applySeek(card, ratio);
}

function seekToTouch(e, card, bar) {
  if (!podcastAudioEl || !podcastAudioEl.duration || !isFinite(podcastAudioEl.duration)) return;
  const rect = bar.getBoundingClientRect();
  const touch = e.touches[0] || e.changedTouches[0];
  if (!touch) return;
  const ratio = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
  applySeek(card, ratio);
}

function applySeek(card, ratio) {
  const targetTime = ratio * podcastAudioEl.duration;

  if (podcastSourceBuffer && podcastSourceBuffer.buffered.length > 0) {
    const bufEnd = podcastSourceBuffer.buffered.end(podcastSourceBuffer.buffered.length - 1);
    podcastAudioEl.currentTime = Math.min(targetTime, bufEnd);
  } else {
    podcastAudioEl.currentTime = targetTime;
  }

  const fill = card.querySelector('.podcast-progress-fill');
  const thumb = card.querySelector('.podcast-progress-thumb');
  const timeEl = card.querySelector('.podcast-time');
  if (fill) fill.style.width = (ratio * 100) + '%';
  if (thumb) thumb.style.left = (ratio * 100) + '%';
  if (timeEl) {
    timeEl.textContent = `${formatDuration(podcastAudioEl.currentTime)} / ${formatDuration(podcastAudioEl.duration)}`;
  }

  syncHighlightToTime(podcastAudioEl.currentTime, card);
}

function syncHighlightToTime(currentTime, card) {
  if (_roundTimings.length === 0) return;
  let roundIdx = -1;
  for (let i = 0; i < _roundTimings.length; i++) {
    if (currentTime >= _roundTimings[i].startTime && currentTime < _roundTimings[i].endTime) {
      roundIdx = i;
      break;
    }
  }
  if (roundIdx === -1 && currentTime >= _roundTimings[_roundTimings.length - 1].endTime) {
    roundIdx = _roundTimings.length - 1;
  }
  updateTranscriptHighlight(roundIdx, card);
}

function addDownloadButton(card) {
  if (card.querySelector('.podcast-download-btn')) return;
  const playerRow = card.querySelector('.podcast-player-row');
  if (!playerRow) return;
  const btn = document.createElement('button');
  btn.className = 'podcast-download-inline-btn';
  btn.title = t('podcast.download');
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  btn.addEventListener('click', downloadPodcastAudio);
  playerRow.appendChild(btn);
}

function downloadPodcastAudio() {
  if (podcastAudioChunks.length === 0) return;
  const blob = new Blob(podcastAudioChunks, { type: 'audio/mpeg' });
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const name = _podcastTitle || t('podcast.fileName');
  downloadFile(blob, `${name}-${dateStr}.mp3`, 'audio/mpeg');
}

function replayAudio(currentCard) {
  if (podcastAudioEl) {
    podcastAudioEl.currentTime = 0;
    podcastAudioEl.play().catch(() => {});
    if (currentCard) _showStatus(currentCard, 'playing');
  }
}

function finishPodcastAudio(card) {
  if (podcastMediaSource && podcastMediaSource.readyState === 'open') {
    try { podcastMediaSource.endOfStream(); } catch { /* cleanup — safe to ignore */ }
  }
  if (podcastAudioEl && podcastAudioEl.ended) {
    _showStatus(card, 'done');
  }
  _resetPodcastState();
}

async function generatePodcastAudio(card, nlpTexts) {
  if (_isCancelled()) return;

  cleanupPodcastAudio();

  podcastPort = chrome.runtime.connect({ name: 'podcast-audio' });

  podcastPort.postMessage({
    type: 'generate',
    nlpTexts,
    audioConfig: {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 0
    }
  });

  podcastPort.onMessage.addListener((msg) => {
    if (!podcastPort || _isCancelled()) return;

    if (msg.type === 'audio_chunk' && msg.data) {
      if (!podcastAudioEl) {
        initPodcastPlayback(card);
      }
      const binaryStr = atob(msg.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      if (podcastChunkQueue.length >= MAX_CHUNK_QUEUE_SIZE) {
        console.warn('[Podcast] Queue full, dropping oldest chunk');
        podcastChunkQueue.shift();
      }
      podcastChunkQueue.push(bytes.buffer);
      podcastAudioChunks.push(bytes.buffer.slice(0));
      appendPodcastChunk();
    } else if (msg.type === 'round_end' && msg.audioDuration) {
      if (msg.startTime != null && msg.endTime != null) {
        _roundTimings.push({ startTime: msg.startTime, endTime: msg.endTime });
      } else {
        const prevEnd = _roundTimings.length > 0 ? _roundTimings[_roundTimings.length - 1].endTime : 0;
        _roundTimings.push({ startTime: prevEnd, endTime: prevEnd + msg.audioDuration });
      }
    } else if (msg.type === 'done') {
      finishPodcastAudio(card);
    } else if (msg.type === 'error') {
      const errMsg = msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.audioError'));
      _showStatus(card, 'error', errMsg);
      _resetPodcastState();
    }
  });

  podcastPort.onDisconnect.addListener(() => {
    if (_isCancelled()) return;
    if (state.getIsPodcastGenerating()) {
      if (podcastAudioEl && podcastMediaSource && podcastMediaSource.readyState === 'open') {
        try { podcastMediaSource.endOfStream(); } catch { /* cleanup — safe to ignore */ }
        _resetPodcastState();
      } else {
        _showStatus(card, 'error', t('podcast.audioError'));
        _resetPodcastState();
      }
    }
  });
}

export {
  handlePlayPause,
  seekToMouse,
  seekToTouch,
  addDownloadButton,
  downloadPodcastAudio,
  replayAudio,
  generatePodcastAudio,
};
