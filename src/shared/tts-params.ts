/**
 * TTS synthesis parameters shared by the side panel (engine + cache keys) and
 * the service worker (`sw-tts.ts`). Single source of truth so the cache key
 * parts always match what the SW actually sends upstream.
 */

/** Volcengine seed-tts resource id (char-billed 2.0 product). */
export const DEFAULT_TTS_RESOURCE_ID = 'seed-tts-2.0';
export const DEFAULT_TTS_SPEAKER = 'zh_female_vv_uranus_bigtts';

/** Audio format requested from the API — part of the cache key. */
export const TTS_AUDIO_PARAMS = {
  format: 'mp3',
  sampleRate: 24000,
} as const;

/** The voice-defining settings a cache key is namespaced by. */
export interface TTSSynthVoice {
  speaker: string;
  resourceId: string;
}
