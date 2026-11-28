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
import { downloadFile, sanitizeFilename } from '@/shared/download';
import { readSettings, writeSettings } from '@/platform/settings';
import { onSyncChange } from '@/platform/storage';
import * as core from '@/panel/state';
import { stripMarkdown, splitToSegments } from '@/panel/lib/tts/utils';
import { TTSSynthEngine, getTTSVoice } from '@/panel/lib/tts/engine';
import {
  initTTSPlayback as playerStart,
  stopTTSPlayback,
  setFullStopFn,
  setTTSErrorFn,
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

/**
 * F16: the downloaded audio is named after the conversation's title (the
 * same one the header / history list show). No title yet → the legacy
 * timestamped name. Pure so the naming rule is unit-testable.
 */
export function ttsDownloadFilename(chatTitle: string, now: Date = new Date()): string {
  const safe = sanitizeFilename(chatTitle).trim();
  if (safe) return `${safe}_${now.toISOString().slice(0, 10)}.mp3`;
  return `voice-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp3`;
}

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
        // The message's own tab first; a null tabId falls back to the
        // active tab's title (legacy bubbles carry no tab).
        const ts = origin.tabId != null ? core.getStateForTab(origin.tabId) : null;
        const chatTitle = ts?.chatTitle ?? core.getChatTitle();
        downloadFile(blob, ttsDownloadFilename(chatTitle ?? ''), 'audio/mpeg');
      }
      stopTTSDownload();
    },
    onError: (msg, errorKey) => {
      console.error('[TTS Download] error:', msg);
      stopTTSDownload();
      reportTTSError(msg, errorKey);
    },
  });
  for (const seg of segments) _downloadEngine.enqueue(seg);
  _downloadEngine.endInput();
}

// --- Public API --------------------------------------------------------------

let _initialized = false;

/**
 * Tell the user why synthesis failed. Playback (or the download) stops when
 * it does, and it used to stop silently — the reason only reached the
 * console, so a missing credential and an upstream refusal both looked like
 * a button that did nothing. The key names the failure in the UI language;
 * the raw message adds the API's own detail where there is one.
 */
function reportTTSError(message: string, errorKey?: string): void {
  const detail = message && message !== errorKey ? message : '';
  useUIStore.getState().pushToast(
    errorKey ? `${t(errorKey)}${detail ? `：${detail}` : ''}` : (message || t('error.ttsSynthFailed')),
    'error',
  );
}

export function initTTS(): void {
  if (_initialized) return;
  _initialized = true;

  // Natural end of playback (all segments played out) flows through the
  // player's maybeFinished → fullStop hook. Without this wiring the player
  // never stops itself: ttsPlaying stays true forever and the indicator
  // strip never disappears ("播放完组件一直停在那里" bug).
  setFullStopFn(stopAllTTS);
  // …and a failed synthesis is said out loud instead of only logged.
  setTTSErrorFn(reportTTSError);

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

/**
 * The answer was not kept (an error, or stopped before any text): end its
 * autoplay. Nothing was ever fed to it, so left alone it sits on "reading"
 * forever — and the next play click only stops that zombie instead of
 * playing. A playback that took the resource meanwhile is not this one's to
 * stop (the msgId is the stream's own assistant message id).
 */
export function ttsAutoplayAbort(msgId: string): void {
  if (!isTTSPlaying() || getTTSOrigin().msgId !== msgId) return;
  stopTTSPlayback();
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
