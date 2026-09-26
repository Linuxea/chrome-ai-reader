/**
 * Global TTS indicator — the window-global playback's cross-page control.
 *
 * TTS is a "printer resource": it keeps reading across tab switches, so the
 * origin tab's message button is not always reachable. This always-visible
 * chip (mirrors the podcast mini-player) shows playback state and offers the
 * stop control from any tab. Pure DOM — state and stop behavior are injected
 * by services/tts (ui/** must not import services).
 */

export interface TTSIndicatorDeps {
  onStop: () => void;
}

export function initTTSIndicator(deps: TTSIndicatorDeps): void {
  const root = document.getElementById('ttsIndicator');
  root?.querySelector('.tts-indicator-stop')?.addEventListener('click', deps.onStop);
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
}
