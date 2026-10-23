/**
 * Global TTS indicator — the window-global playback's cross-page control.
 *
 * TTS is a "printer resource": it keeps reading across tab switches, so the
 * origin tab's message button is not always reachable. This always-visible
 * chip (mirrors the podcast mini-player) shows playback state and progress,
 * and offers the stop control plus playback-speed cycling from any tab.
 * Pure DOM — state and behavior are injected by services/tts (ui/** must not
 * import services).
 */

import { formatDuration } from '../../shared/format';

export interface TTSIndicatorDeps {
  onStop: () => void;
  /** Cycle to the next playback-rate step; returns nothing (player owns state). */
  onCycleRate: () => void;
}

export function initTTSIndicator(deps: TTSIndicatorDeps): void {
  const root = document.getElementById('ttsIndicator');
  root?.querySelector('.tts-indicator-stop')?.addEventListener('click', deps.onStop);
  root?.querySelector('.tts-indicator-rate')?.addEventListener('click', (e) => {
    e.stopPropagation(); // don't let the click bubble into stop/podcasts area
    deps.onCycleRate();
  });
}

/**
 * playing=false → hidden. playing + !audioStarted → spinner ("waiting for
 * the first audio chunk"); playing + audioStarted → speaker icon.
 */
export function renderTTSIndicator(state: { playing: boolean; audioStarted: boolean }): void {
  const root = document.getElementById('ttsIndicator');
  if (!root) return;
  root.classList.toggle('hidden', !state.playing);
  root.classList.toggle('is-waiting', state.playing && !state.audioStarted);
  if (!state.playing) renderTTSProgress(0, 0);
}

/** "m:ss / m:ss" against the buffered end (MSE streams have no duration). */
export function renderTTSProgress(position: number, end: number): void {
  const el = document.getElementById('ttsIndicatorProgress');
  if (!el) return;
  if (!Number.isFinite(position) || !Number.isFinite(end) || end <= 0) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.textContent = `${formatDuration(position)} / ${formatDuration(end)}`;
}

/** Active rate step on the chip's button (e.g. "1.5×"). */
export function renderTTSRate(rate: number): void {
  const btn = document.getElementById('ttsRateBtn');
  if (!btn) return;
  btn.textContent = `${rate}×`;
}
