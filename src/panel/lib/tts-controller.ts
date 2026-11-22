/**
 * TTS controller — React port of services/tts/index.ts.
 *
 * The WebAudio player and the synthesis engine are reused verbatim (the
 * hard-won invariants live there: single takeover point, pipelined
 * synthesis, order-preserving decode queue). What changes is the surface:
 * - button state is DERIVED (tts-store) instead of classList on a DOM
 *   anchor — detach/reattach across tab switches becomes unnecessary;
 * - the download loop is re-driven through the same engine with state in
 *   the store;
 * - the podcast mutual exclusion uses a direct call instead of the legacy
 *   DOM-carrying event bus (defensive import — the podcast controller may
 *   not exist yet).
 */
import { t } from '@/shared/i18n.js';
import { downloadFile } from '@/shared/download';
import { readSettings, writeSettings } from '@/platform/settings';
import { onSyncChange } from '@/platform/storage';
import { stripMarkdown, splitToSegments } from '@/panel/lib/tts/utils';
import { TTSSynthEngine, getTTSVoice } from '@/panel/lib/tts/engine';
import {
  initTTSPlayback as playerStart,
  stopTTSPlayback,
  subscribeTTSState,
  subscribeTTSProgress,
  getTTSOrigin,
  ttsEnqueue,
  ttsFinishInput,
  ttsAppendChunk,
  ttsFlushRemaining,
  isTTSPlaying,
  isTTSAutoPlay,
  setTTSAutoPlay,
  TTS_SPEED_STEPS,
  setTTSPlaybackRate,
  getTTSPlaybackRate,
} from '@/panel/lib/tts/player';
import { setTTSView, useTTSStore } from '@/panel/stores/tts-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { stopPodcastIfRunning } from '@/panel/lib/audio-resource';

// --- Download loop (engine-driven, state in store) ---------------------------

let _downloadEngine: TTSSynthEngine | null = null;
let _downloadChunks: ArrayBuffer[] = [];

export function stopTTSDownload(): void {
  _downloadEngine?.abort();
  _downloadEngine = null;
  _downloadChunks = [];
  setTTSView({ downloading: null });
}

function startDownload(origin: { tabId: number | null; msgId: string | null }, markdown: string): void {
  if (useTTSStore.getState().downloading) return;
  const cleaned = stripMarkdown(markdown);
  if (!cleaned.trim()) return;
  const segments = splitToSegments(cleaned);
  if (segments.length === 0) return;

  setTTSView({ downloading: origin });
  _downloadChunks = [];
  _downloadEngine = new TTSSynthEngine({
    voice: getTTSVoice(),
    // No playback clock — synthesize at full speed (bounded by maxInflight).
    getBufferedAheadMs: () => 0,
    onSegmentAudio: bytes => { _downloadChunks.push(bytes); },
    onDrained: () => {
      if (_downloadChunks.length > 0) {
        const blob = new Blob(_downloadChunks, { type: 'audio/mpeg' });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadFile(blob, `voice-${timestamp}.mp3`, 'audio/mpeg');
      }
      stopTTSDownload();
    },
    onError: msg => {
      console.error('[TTS Download] error:', msg);
      stopTTSDownload();
      useUIStore.getState().pushToast(t('error.apiFailed'), 'error');
    },
  });
  for (const seg of segments) _downloadEngine.enqueue(seg);
  _downloadEngine.endInput();
}

// --- Public API --------------------------------------------------------------

let _initialized = false;

export function initTTS(): void {
  if (_initialized) return;
  _initialized = true;

  chrome.storage.sync.get(['ttsAutoPlay'], data => {
    setTTSAutoPlay(data.ttsAutoPlay === true);
  });
  onSyncChange('ttsAutoPlay', v => setTTSAutoPlay(v === true));

  readSettings(['ttsSpeed']).then(s => {
    const rate = typeof s.ttsSpeed === 'number' && s.ttsSpeed > 0 ? s.ttsSpeed : 1;
    setTTSPlaybackRate(rate);
    setTTSView({ rate });
  }).catch(() => {});

  // Bridge the player's notifications into the store.
  subscribeTTSState(({ playing, audioStarted }) => {
    setTTSView({ playing, audioStarted, origin: { ...getTTSOrigin() } });
  });
  subscribeTTSProgress(progress => setTTSView({ progress }));
}

/** The full stop: playback + download (global chip / takeover point). */
export function stopAllTTS(): void {
  stopTTSDownload();
  stopTTSPlayback();
}

/** The per-answer play button: toggle playback for one message. */
export function handleTTSButtonClick(msg: { tabId: number | null; msgId: string; markdown: string }): void {
  if (isTTSPlaying()) {
    stopAllTTS();
    return;
  }
  const cleaned = stripMarkdown(msg.markdown);
  if (!cleaned.trim()) return;
  claimAudioResource();
  playerStart(null, { tabId: msg.tabId, msgId: msg.msgId });
  const segments = splitToSegments(cleaned);
  for (const seg of segments) ttsEnqueue(seg);
  ttsFinishInput();
}

/** The per-answer download button. */
export function handleTTSDownloadClick(msg: { tabId: number | null; msgId: string; markdown: string }): void {
  startDownload({ tabId: msg.tabId, msgId: msg.msgId }, msg.markdown);
}

// --- Autoplay (stream-controller hooks) ---------------------------------------

/** A new answer is about to stream: claim the audio resource for it. */
export function ttsAutoplayStart(tabId: number, msgId: string): void {
  if (!isTTSAutoPlay()) return;
  claimAudioResource();
  playerStart(null, { tabId, msgId });
}

export function ttsAutoplayChunk(content: string): void {
  ttsAppendChunk(content);
}

export function ttsAutoplayFinish(): void {
  if (!isTTSPlaying()) return;
  ttsFlushRemaining();
}

// --- Rate cycle (global indicator) ---------------------------------------------

export function cycleTTSRate(): void {
  const steps: readonly number[] = TTS_SPEED_STEPS;
  const idx = steps.indexOf(getTTSPlaybackRate());
  const next = steps[(idx + 1) % steps.length] ?? 1;
  setTTSPlaybackRate(next);
  setTTSView({ rate: next });
  void writeSettings({ ttsSpeed: next }).catch(() => {});
}

/** Starting any TTS playback stops a running podcast (window-global resource). */
function claimAudioResource(): void {
  stopPodcastIfRunning();
}
