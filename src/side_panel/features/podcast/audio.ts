import { t } from '../../../shared/i18n.js';
import { downloadFile } from '../../../shared/download';
import { formatDuration } from '../../../shared/format';
import * as state from '../../state';
import { MAX_CHUNK_QUEUE_SIZE } from './constants';
import { updateTranscriptHighlight } from './ui';

let podcastPort: chrome.runtime.Port | null = null;
let podcastAudioEl: HTMLAudioElement | null = null;
let podcastMediaSource: MediaSource | null = null;
let podcastSourceBuffer: SourceBuffer | null = null;
let podcastChunkQueue: ArrayBuffer[] = [];
let podcastBufferAppending = false;
let podcastPlayTransitioning = false;
let podcastAudioChunks: ArrayBuffer[] = [];
let _podcastTitle = '';
let _roundTimings: { startTime: number; endTime: number }[] = [];

let _showStatus: ((card: HTMLElement, status: string, text?: string) => void) | null = null;
let _resetPodcastState: (() => void) | null = null;
let _isCancelled: (() => boolean) | null = null;

export function initAudioCallbacks(deps: { showStatus: (card: HTMLElement, status: string, text?: string) => void; resetPodcastState: () => void; isCancelled: () => boolean }): void {
  _showStatus = deps.showStatus; _resetPodcastState = deps.resetPodcastState; _isCancelled = deps.isCancelled;
}

export function setPodcastTitle(title: string): void { _podcastTitle = title; }
export function resetRoundTimings(): void { _roundTimings = []; }

export function cleanupPodcastAudio(): void {
  if (podcastAudioEl) { podcastAudioEl.pause(); podcastAudioEl.src = ''; podcastAudioEl = null; }
  if (podcastMediaSource) { try { if (podcastMediaSource.readyState === 'open') podcastMediaSource.endOfStream(); } catch { /* cleanup */ } podcastMediaSource = null; podcastSourceBuffer = null; }
  if (podcastPort) { try { podcastPort.disconnect(); } catch { /* cleanup */ } podcastPort = null; }
  podcastChunkQueue = []; podcastAudioChunks = []; podcastBufferAppending = false; _podcastTitle = ''; _roundTimings = [];
}

function initPodcastPlayback(card: HTMLElement): void {
  if (podcastAudioEl) { podcastAudioEl.pause(); podcastAudioEl.src = ''; podcastAudioEl = null; }
  if (podcastMediaSource) { try { if (podcastMediaSource.readyState === 'open') podcastMediaSource.endOfStream(); } catch { /* cleanup */ } podcastMediaSource = null; podcastSourceBuffer = null; }
  podcastChunkQueue = []; podcastBufferAppending = false;
  const ms = new MediaSource(); podcastMediaSource = ms;
  const audio = new Audio(); audio.src = URL.createObjectURL(ms); podcastAudioEl = audio;
  ms.addEventListener('sourceopen', () => {
    if (podcastMediaSource !== ms || ms.sourceBuffers.length > 0) return;
    podcastSourceBuffer = ms.addSourceBuffer('audio/mpeg');
    podcastSourceBuffer.addEventListener('updateend', () => {
      podcastBufferAppending = false;
      if (podcastAudioEl && podcastAudioEl.paused && podcastSourceBuffer!.buffered.length > 0) podcastAudioEl.play().catch(() => {});
      appendPodcastChunk();
    });
  });
  audio.addEventListener('timeupdate', () => updatePlayerProgress(card));
  audio.addEventListener('ended', () => _showStatus!(card, 'done'));
  _showStatus!(card, 'playing');
}

function appendPodcastChunk(): void {
  if (!podcastSourceBuffer || podcastBufferAppending || podcastChunkQueue.length === 0) return;
  podcastBufferAppending = true;
  const chunk = podcastChunkQueue.shift()!;
  try { podcastSourceBuffer.appendBuffer(chunk); } catch (e) { console.error('[Podcast] appendBuffer error:', e); podcastBufferAppending = false; }
}

function updatePlayerProgress(card: HTMLElement): void {
  if (!podcastAudioEl) return;
  const fill = card.querySelector('.podcast-progress-fill') as HTMLElement | null;
  const thumb = card.querySelector('.podcast-progress-thumb') as HTMLElement | null;
  const timeEl = card.querySelector('.podcast-time') as HTMLElement | null;
  const playBtn = card.querySelector('.podcast-play-btn') as HTMLElement | null;
  if (podcastAudioEl.duration && isFinite(podcastAudioEl.duration)) {
    const pct = (podcastAudioEl.currentTime / podcastAudioEl.duration) * 100;
    if (fill) fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
    if (timeEl) timeEl.textContent = `${formatDuration(podcastAudioEl.currentTime)} / ${formatDuration(podcastAudioEl.duration)}`;
  }
  if (playBtn) {
    if (podcastAudioEl.paused) { playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`; playBtn.title = t('podcast.play'); }
    else { playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`; playBtn.title = t('podcast.pause'); }
  }
  if (_roundTimings.length > 0 && !podcastAudioEl.paused) {
    const ct = podcastAudioEl.currentTime; let roundIdx = -1;
    for (let i = 0; i < _roundTimings.length; i++) { if (ct >= _roundTimings[i].startTime && ct < _roundTimings[i].endTime) { roundIdx = i; break; } }
    if (roundIdx === -1 && ct >= _roundTimings[_roundTimings.length - 1].endTime) roundIdx = _roundTimings.length - 1;
    updateTranscriptHighlight(roundIdx, card);
  }
}

export function handlePlayPause(): void {
  if (!podcastAudioEl || podcastPlayTransitioning) return;
  podcastPlayTransitioning = true; setTimeout(() => { podcastPlayTransitioning = false; }, 300);
  if (podcastAudioEl.paused) podcastAudioEl.play().catch(() => {}); else podcastAudioEl.pause();
}

export function seekToMouse(e: MouseEvent, card: HTMLElement, bar: HTMLElement): void {
  if (!podcastAudioEl || !podcastAudioEl.duration || !isFinite(podcastAudioEl.duration)) return;
  const rect = bar.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  applySeek(card, ratio);
}

export function seekToTouch(e: TouchEvent, card: HTMLElement, bar: HTMLElement): void {
  if (!podcastAudioEl || !podcastAudioEl.duration || !isFinite(podcastAudioEl.duration)) return;
  const rect = bar.getBoundingClientRect(); const touch = e.touches[0] || e.changedTouches[0]; if (!touch) return;
  applySeek(card, Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)));
}

function applySeek(card: HTMLElement, ratio: number): void {
  const targetTime = ratio * podcastAudioEl!.duration;
  if (podcastSourceBuffer && podcastSourceBuffer.buffered.length > 0) podcastAudioEl!.currentTime = Math.min(targetTime, podcastSourceBuffer.buffered.end(podcastSourceBuffer.buffered.length - 1));
  else podcastAudioEl!.currentTime = targetTime;
  const fill = card.querySelector('.podcast-progress-fill') as HTMLElement | null;
  const thumb = card.querySelector('.podcast-progress-thumb') as HTMLElement | null;
  const timeEl = card.querySelector('.podcast-time') as HTMLElement | null;
  if (fill) fill.style.width = (ratio * 100) + '%'; if (thumb) thumb.style.left = (ratio * 100) + '%';
  if (timeEl) timeEl.textContent = `${formatDuration(podcastAudioEl!.currentTime)} / ${formatDuration(podcastAudioEl!.duration)}`;
  syncHighlightToTime(podcastAudioEl!.currentTime, card);
}

function syncHighlightToTime(currentTime: number, card: HTMLElement): void {
  if (_roundTimings.length === 0) return; let roundIdx = -1;
  for (let i = 0; i < _roundTimings.length; i++) { if (currentTime >= _roundTimings[i].startTime && currentTime < _roundTimings[i].endTime) { roundIdx = i; break; } }
  if (roundIdx === -1 && currentTime >= _roundTimings[_roundTimings.length - 1].endTime) roundIdx = _roundTimings.length - 1;
  updateTranscriptHighlight(roundIdx, card);
}

export function addDownloadButton(card: HTMLElement): void {
  if (card.querySelector('.podcast-download-btn')) return;
  const playerRow = card.querySelector('.podcast-player-row'); if (!playerRow) return;
  const btn = document.createElement('button'); btn.className = 'podcast-download-inline-btn'; btn.title = t('podcast.download');
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  btn.addEventListener('click', downloadPodcastAudio); playerRow.appendChild(btn);
}

export function downloadPodcastAudio(): void {
  if (podcastAudioChunks.length === 0) return;
  const blob = new Blob(podcastAudioChunks, { type: 'audio/mpeg' });
  const now = new Date(); const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  downloadFile(blob, `${_podcastTitle || t('podcast.fileName')}-${dateStr}.mp3`, 'audio/mpeg');
}

export function replayAudio(currentCard: HTMLElement | null): void {
  if (podcastAudioEl) { podcastAudioEl.currentTime = 0; podcastAudioEl.play().catch(() => {}); if (currentCard) _showStatus!(currentCard, 'playing'); }
}

function finishPodcastAudio(card: HTMLElement): void {
  if (podcastMediaSource && podcastMediaSource.readyState === 'open') { try { podcastMediaSource.endOfStream(); } catch { /* cleanup */ } }
  if (podcastAudioEl && podcastAudioEl.ended) _showStatus!(card, 'done');
  _resetPodcastState!();
}

interface NlpRound { speaker: string; text: string; speakerLabel: string; }

export async function generatePodcastAudio(card: HTMLElement, nlpTexts: NlpRound[]): Promise<void> {
  if (_isCancelled?.()) return;
  cleanupPodcastAudio();
  podcastPort = chrome.runtime.connect({ name: 'podcast-audio' });
  podcastPort.postMessage({ type: 'generate', nlpTexts, audioConfig: { format: 'mp3', sample_rate: 24000, speech_rate: 0 } });
  podcastPort.onMessage.addListener((msg: { type: string; data?: string; audioDuration?: number; startTime?: number; endTime?: number; error?: string; errorKey?: string }) => {
    if (!podcastPort || _isCancelled?.()) return;
    if (msg.type === 'audio_chunk' && msg.data) {
      if (!podcastAudioEl) initPodcastPlayback(card);
      const binaryStr = atob(msg.data); const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      if (podcastChunkQueue.length >= MAX_CHUNK_QUEUE_SIZE) { console.warn('[Podcast] Queue full, dropping oldest chunk'); podcastChunkQueue.shift(); }
      podcastChunkQueue.push(bytes.buffer); podcastAudioChunks.push(bytes.buffer.slice(0)); appendPodcastChunk();
    } else if (msg.type === 'round_end' && msg.audioDuration) {
      if (msg.startTime != null && msg.endTime != null) _roundTimings.push({ startTime: msg.startTime, endTime: msg.endTime });
      else { const prevEnd = _roundTimings.length > 0 ? _roundTimings[_roundTimings.length - 1].endTime : 0; _roundTimings.push({ startTime: prevEnd, endTime: prevEnd + msg.audioDuration }); }
    } else if (msg.type === 'done') { finishPodcastAudio(card); }
    else if (msg.type === 'error') { _showStatus!(card, 'error', msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.audioError'))); _resetPodcastState!(); }
  });
  podcastPort.onDisconnect.addListener(() => {
    if (_isCancelled?.()) return;
    if (state.getIsPodcastGenerating()) {
      if (podcastAudioEl && podcastMediaSource && podcastMediaSource.readyState === 'open') { try { podcastMediaSource.endOfStream(); } catch { /* cleanup */ } _resetPodcastState!(); }
      else { _showStatus!(card, 'error', t('podcast.audioError')); _resetPodcastState!(); }
    }
  });
}
