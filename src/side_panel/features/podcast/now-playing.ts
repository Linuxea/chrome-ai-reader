/**
 * Window-global "now playing" registry for the podcast feature.
 *
 * Podcast audio state (the live HTMLAudioElement, queues, ports) lives in
 * audio.ts as module-level singletons — there is exactly one podcast stream
 * per side-panel window. This module tracks the *metadata* that decouples
 * that single stream from any one tab's chatArea: which tab originated it,
 * the transcript script, title, and current status. It lets a podcast keep
 * playing in the background when the user switches tabs, with a persistent
 * mini-player reflecting it regardless of the active tab.
 *
 * Memory-only (Audio/ArrayBuffer are not serializable), so it does not survive
 * a side-panel reload — on reload nowPlaying is null and the mini-player hides.
 */

export interface NlpRound {
  speaker: string;
  text: string;
  speakerLabel: string;
}

export type PodcastStatus =
  | 'generating_script'
  | 'generating_audio'
  | 'playing'
  | 'done'
  | 'error';

export interface NowPlaying {
  /** Tab that originated the podcast. The full card is re-rendered when the
   *  user returns to this tab; other tabs show only the mini-player. */
  originTabId: number;
  originTabTitle: string;
  /** Podcast title (filled in after script parsing / metadata generation). */
  title: string;
  /** Short summary of the podcast (from metadata generation). Restored on
   *  card rebuild so it survives tab switches. */
  description?: string;
  /** Parsed transcript rounds — used to rebuild the full card on return. */
  script: NlpRound[];
  status: PodcastStatus;
  /** Optional status text (e.g. error message). */
  statusText?: string;
  /** Quote-preview source text the podcast was generated from, if any. */
  sourcePreview?: string;
}

let _nowPlaying: NowPlaying | null = null;

type Listener = (np: NowPlaying | null) => void;
const _listeners = new Set<Listener>();

export function getNowPlaying(): NowPlaying | null {
  return _nowPlaying;
}

export function setNowPlaying(np: NowPlaying): void {
  _nowPlaying = np;
  notify();
}

export function updateNowPlaying(patch: Partial<NowPlaying>): void {
  if (!_nowPlaying) return;
  _nowPlaying = { ..._nowPlaying, ...patch };
  notify();
}

export function clearNowPlaying(): void {
  _nowPlaying = null;
  notify();
}

/** True when a podcast is actively generating (script or audio phase). */
export function isNowPlayingGenerating(): boolean {
  return (
    _nowPlaying?.status === 'generating_script' ||
    _nowPlaying?.status === 'generating_audio'
  );
}

export function subscribeNowPlaying(cb: Listener): () => void {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

function notify(): void {
  _listeners.forEach((cb) => cb(_nowPlaying));
}
