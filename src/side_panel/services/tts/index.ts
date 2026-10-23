import { CSS } from '../../../shared/css-selectors';
import { onSyncChange } from '../../../platform/storage';
import { readSettings, writeSettings } from '../../../platform/settings';
import { on, emit, EVENTS } from '../../events';
import * as state from '../../state';
import { createTTSButtons } from '../../ui/tts-buttons';
import { initTTSIndicator, renderTTSIndicator, renderTTSProgress, renderTTSRate } from '../../ui/tts-indicator';
import { stripMarkdown, splitToSegments } from './utils';
import {
  initPlayer, setFullStopFn, setTTSAutoPlay,
  isTTSPlaying as _isTTSPlaying,
  isTTSAutoPlay as _isTTSAutoPlay,
  isTTSAudioStarted as _isTTSAudioStarted,
  initTTSPlayback as _initTTSPlayback,
  ttsAppendChunk as _ttsAppendChunk,
  ttsEnqueue, ttsFinishInput, ttsFlushRemaining, stopTTSPlayback,
  getTTSButton, setTTSButton, subscribeTTSState, subscribeTTSProgress,
  getTTSOrigin, setTTSOrigin, detachTTSAnchor,
  TTS_SPEED_STEPS, setTTSPlaybackRate, getTTSPlaybackRate,
} from './player';
import {
  initDownloader, stopTTSDownload, handleTTSDownloadClick,
  detachDownloadAnchor, reattachDownloadAnchor, getDownloadOrigin, isTTSDownloading,
} from './downloader';

let _chatArea: HTMLElement | null = null;

export function initTTS({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
  initPlayer(chatArea);
  initDownloader(chatArea);

  setFullStopFn(stopTTS);

  chrome.storage.sync.get(['ttsAutoPlay'], (data) => {
    setTTSAutoPlay(data.ttsAutoPlay === true);
  });

  onSyncChange('ttsAutoPlay', (newValue) => {
    setTTSAutoPlay(newValue === true);
  });

  // Persisted playback speed: applied to the running playback (if any) and
  // every future one by the player; the indicator shows the active step.
  readSettings(['ttsSpeed']).then((s) => {
    const rate = typeof s.ttsSpeed === 'number' && s.ttsSpeed > 0 ? s.ttsSpeed : 1;
    setTTSPlaybackRate(rate);
    renderTTSRate(rate);
  }).catch(() => {});

  // The chat area was rebuilt (tab switch / re-render / branch switch): bring
  // the window-global playback's button state back onto the fresh bubble.
  on(EVENTS.CHAT_RERENDERED, reattachTTSAfterRerender);

  // Global cross-page indicator: TTS keeps reading on other tabs; this chip
  // is the always-available stop control (mirrors the podcast mini-player).
  initTTSIndicator({ onStop: stopTTS, onCycleRate: cyclePlaybackRate });
  subscribeTTSState(renderTTSIndicator);
  subscribeTTSProgress(({ position, end }) => renderTTSProgress(position, end));
  renderTTSIndicator({ playing: _isTTSPlaying(), audioStarted: _isTTSAudioStarted() });
}

export function isTTSPlaying(): boolean { return _isTTSPlaying(); }
export function isTTSAutoPlay(): boolean { return _isTTSAutoPlay(); }

function cyclePlaybackRate(): void {
  const steps: readonly number[] = TTS_SPEED_STEPS;
  const idx = steps.indexOf(getTTSPlaybackRate());
  const next = steps[(idx + 1) % steps.length] ?? 1;
  setTTSPlaybackRate(next);
  renderTTSRate(next);
  void writeSettings({ ttsSpeed: next }).catch(() => {});
}

/**
 * Tab switch / chat load: TTS is a window-global "printer resource" — the
 * audio keeps playing; only the DOM anchors are detached (their bubbles are
 * about to be discarded). CHAT_RERENDERED re-attaches on return.
 */
export function detachTTS(): void {
  detachTTSAnchor();
  detachDownloadAnchor();
}

export function stopTTS(): void {
  stopTTSDownload();
  stopTTSPlayback();

  // Reset the button of the message that was being read (not just the first
  // one in the chat).
  const btn = getTTSButton();
  if (btn) {
    btn.classList.remove(CSS.TTS_PLAYING.replace('.', ''), CSS.TTS_LOADING.replace('.', ''));
  }
  setTTSButton(null);
}

/**
 * Autoplay entry (stream-handler): claim the audio resource for the answer
 * about to stream. A running podcast stops (event — the feature layer cannot
 * be imported from services) and any previous TTS playback is stopped by the
 * player's takeover point.
 */
export function initTTSPlayback(origin?: { tabId?: number | null; msgId?: string | null }): void {
  emit(EVENTS.PODCAST_STOP_REQUEST);
  _initTTSPlayback(null, {
    tabId: origin?.tabId !== undefined ? origin.tabId : state.getActiveTabId(),
    msgId: origin?.msgId !== undefined ? origin.msgId : null,
  });
}

export { _ttsAppendChunk as ttsAppendChunk };

function handleTTSButtonClick(msgEl: HTMLElement): void {
  if (_isTTSPlaying()) {
    stopTTS();
    return;
  }

  // Prefer the markdown source — identical to what autoplay streamed, so the
  // segment boundaries (and with them the cache keys) match across paths.
  const contentEl = msgEl.querySelector('.thinking-response-content');
  const source = msgEl.dataset.markdown || (contentEl ? contentEl.textContent : msgEl.textContent) || '';
  const cleaned = stripMarkdown(source);
  if (!cleaned.trim()) return;

  // Claim the single audio resource: a running podcast stops (event).
  emit(EVENTS.PODCAST_STOP_REQUEST);
  _initTTSPlayback(msgEl.querySelector(CSS.TTS_BTN), {
    tabId: state.getActiveTabId(),
    msgId: msgEl.dataset.msgId ?? null,
  });
  const segments = splitToSegments(cleaned);
  segments.forEach(seg => ttsEnqueue(seg));
  ttsFinishInput();
}

export function addTTSButton(msgEl: HTMLElement): void {
  createTTSButtons(msgEl, {
    onToggleTTS: handleTTSButtonClick,
    onDownload: handleTTSDownloadClick,
  });
}

/**
 * CHAT_RERENDERED: the chat area was rebuilt. If the window-global playback
 * (or download) originated from the now-active tab, re-bind its button to
 * the freshly rendered bubble — otherwise the stale anchor is dropped.
 */
function reattachTTSAfterRerender(): void {
  const tabId = state.getActiveTabId();
  const area = _chatArea;
  if (tabId == null || !area) return;

  if (_isTTSPlaying()) {
    const origin = getTTSOrigin();
    const btn = origin.tabId === tabId && origin.msgId
      ? area.querySelector(`[data-msg-id="${origin.msgId}"] ${CSS.TTS_BTN}`)
      : null;
    setTTSButton(btn);
  }

  if (isTTSDownloading()) {
    const dOrigin = getDownloadOrigin();
    const btn = dOrigin.tabId === tabId && dOrigin.msgId
      ? area.querySelector(`[data-msg-id="${dOrigin.msgId}"] ${CSS.TTS_DOWNLOAD_BTN}`) as HTMLButtonElement | null
      : null;
    reattachDownloadAnchor(btn);
  }
}

/** Answer finished: flush the autoplay tail and show its state on the answer's TTS button. */
export function initTTSAutoPlay(msgEl?: HTMLElement): void {
  if (!_isTTSAutoPlay()) return;
  if (!_isTTSPlaying()) return;

  if (msgEl) {
    setTTSButton(msgEl.querySelector(CSS.TTS_BTN));
    setTTSOrigin({ msgId: msgEl.dataset.msgId ?? null });
  }
  ttsFlushRemaining();
}
