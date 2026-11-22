/**
 * Podcast store — the React-visible face of the window-global podcast
 * resource (F13).
 *
 * Two things live here, both deliberately OUTSIDE any tab's state:
 *
 * 1. The "now playing" registry — a semantic port of the legacy
 *    `side_panel/features/podcast/now-playing.ts` (which cannot be imported
 *    from panel/: dep-cruiser forbids `side_panel/features`). It decouples
 *    the single podcast stream from any one tab: the ORIGIN tab's card, the
 *    transcript script, title and status survive tab switches, so playback
 *    continues in the background while other tabs see only the mini-player.
 *    Like the legacy registry it is memory-only — the audio element,
 *    MediaSource and byte buffers are not serializable, so nothing here
 *    persists and a panel reload starts with `nowPlaying: null`.
 *
 * 2. The playback mirror (play/pause, playhead, round timings, has-audio)
 *    — the data the legacy audio.ts pushed into DOM nodes via callbacks;
 *    here the controller writes it and the card/mini-player derive from it.
 *
 * The TTS↔podcast mutual exclusion ("PODCAST_STOP_REQUEST" on the legacy
 * event bus) is a plain listener registry exported from this module:
 * `subscribePodcastStop(cb)` + `stopPodcastForTTS()`. The TTS side calls
 * the emitter when it claims the single audio resource; the podcast
 * controller subscribes and does the actual teardown (full stop while
 * generating, graceful pause-keep-buffers while playing).
 */
import { create } from 'zustand';

// --- Now-playing registry types (semantic port of now-playing.ts) -----------

export interface NlpRound {
  /** Volcengine voice id (mapped from the script's A/B speaker label). */
  speaker: string;
  text: string;
  /** Original 'A' | 'B' label from the generated script. */
  speakerLabel: string;
}

export type PodcastStatus =
  | 'generating_script'
  | 'generating_audio'
  | 'playing'
  | 'done'
  | 'error';

export interface NowPlaying {
  /** Tab that originated the podcast. The full card renders only on this
   *  tab; every other tab shows the mini-player. */
  originTabId: number;
  originTabTitle: string;
  /** Podcast title (filled after script parsing / metadata generation). */
  title: string;
  /** Short summary from metadata generation; restored with the card. */
  description?: string;
  /** Parsed transcript rounds — the card's transcript source. */
  script: NlpRound[];
  status: PodcastStatus;
  /** Optional status text (e.g. the error message). */
  statusText?: string;
  /** Quote-preview source text the podcast was generated from, if any. */
  sourcePreview?: string;
}

export interface RoundTiming {
  startTime: number;
  endTime: number;
}

/** True while a podcast session is in either generation phase. */
export function isPodcastStatusGenerating(status: PodcastStatus): boolean {
  return status === 'generating_script' || status === 'generating_audio';
}

// --- Store -------------------------------------------------------------------

interface PodcastStoreState {
  nowPlaying: NowPlaying | null;

  // Playback mirror (window-global; meaningful only while nowPlaying lives).
  playing: boolean;
  currentTime: number;
  duration: number;
  /** Per-round playhead ranges, in script order — drives the transcript highlight. */
  roundTimings: RoundTiming[];
  /** Whether any audio bytes are buffered (replay / download available). */
  hasAudio: boolean;

  setNowPlaying: (np: NowPlaying) => void;
  /** Patch the current session; no-op when nothing is playing. */
  updateNowPlaying: (patch: Partial<NowPlaying>) => void;
  clearNowPlaying: () => void;

  setPlayback: (p: { playing?: boolean; currentTime?: number; duration?: number }) => void;
  setRoundTimings: (timings: RoundTiming[]) => void;
  setHasAudio: (v: boolean) => void;
  /** Reset the playback mirror to its idle values (stop / new session). */
  resetPlayback: () => void;
}

const PLAYBACK_IDLE = {
  playing: false,
  currentTime: 0,
  duration: 0,
  roundTimings: [] as RoundTiming[],
  hasAudio: false,
};

export const usePodcastStore = create<PodcastStoreState>()(set => ({
  nowPlaying: null,
  ...PLAYBACK_IDLE,

  setNowPlaying: np => set({ nowPlaying: np }),

  updateNowPlaying: patch =>
    set(s => (s.nowPlaying ? { nowPlaying: { ...s.nowPlaying, ...patch } } : s)),

  clearNowPlaying: () => set({ nowPlaying: null }),

  setPlayback: p => set(p),

  setRoundTimings: timings => set({ roundTimings: timings }),

  setHasAudio: v => set({ hasAudio: v }),

  resetPlayback: () => set({ ...PLAYBACK_IDLE }),
}));

/** Snapshot accessor for non-React callers (the controller). */
export function getNowPlaying(): NowPlaying | null {
  return usePodcastStore.getState().nowPlaying;
}

/** True when a podcast session is actively generating (either phase). */
export function isNowPlayingGenerating(): boolean {
  const np = usePodcastStore.getState().nowPlaying;
  return !!np && isPodcastStatusGenerating(np.status);
}

// --- TTS → podcast stop signal (PODCAST_STOP_REQUEST equivalent) --------------

type PodcastStopListener = () => void;

const _stopListeners = new Set<PodcastStopListener>();

/**
 * Subscribe to "TTS claimed the audio resource" signals. The controller
 * implements the actual policy (cancel while generating / graceful stop
 * while playing); this registry only carries the signal so the store stays
 * consumer-free (stores sit below lib/controllers in the layering).
 */
export function subscribePodcastStop(cb: PodcastStopListener): () => void {
  _stopListeners.add(cb);
  return () => {
    _stopListeners.delete(cb);
  };
}

/** Emitted by the TTS side when it claims the single audio resource. */
export function stopPodcastForTTS(): void {
  _stopListeners.forEach(cb => cb());
}
