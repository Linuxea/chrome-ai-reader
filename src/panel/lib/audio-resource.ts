/**
 * Cross-feature audio takeover: TTS and the podcast are window-global
 * "printer resources" — whichever starts claims the audio and stops the
 * other. Registration indirection keeps tts-controller and
 * podcast-controller decoupled (no import cycle); App wires the concrete
 * stop functions at startup.
 */

let _podcastStop: (() => void) | null = null;

export function registerPodcastStop(fn: (() => void) | null): void {
  _podcastStop = fn;
}

/** Called when a TTS playback/download claims the audio resource. */
export function stopPodcastIfRunning(): void {
  try { _podcastStop?.(); } catch { /* podcast stop must never break TTS */ }
}

let _ttsStop: (() => void) | null = null;

export function registerTTSStop(fn: (() => void) | null): void {
  _ttsStop = fn;
}

/** Called when a podcast starts and claims the audio resource. */
export function stopTTSIfRunning(): void {
  try { _ttsStop?.(); } catch { /* TTS stop must never break the podcast */ }
}
