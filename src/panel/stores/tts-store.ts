/**
 * TTS store — the React-visible face of the window-global TTS resource.
 * The WebAudio player (`side_panel/services/tts/player.ts`) is reused
 * verbatim; its DOM button anchoring is bypassed (buttons are never passed
 * in) and its state/progress/origin notifications are bridged here, so
 * per-message buttons and the global indicator derive from state instead
 * of reattached DOM nodes.
 */
import { create } from 'zustand';
import type { TTSOrigin } from '@/panel/lib/tts/player';

export interface TTSPlaybackView {
  playing: boolean;
  audioStarted: boolean;
  origin: TTSOrigin;
  /** m:ss / m:ss playhead — null while nothing is scheduled. */
  progress: { position: number; end: number } | null;
  rate: number;
  /** Window-global download (one at a time), keyed by origin. */
  downloading: TTSOrigin | null;
}

interface TTSStore extends TTSPlaybackView {
  _set: (patch: Partial<TTSPlaybackView>) => void;
}

export const useTTSStore = create<TTSStore>()(set => ({
  playing: false,
  audioStarted: false,
  origin: { tabId: null, msgId: null },
  progress: null,
  rate: 1,
  downloading: null,
  _set: patch => set(patch),
}));

export function setTTSView(patch: Partial<TTSPlaybackView>): void {
  useTTSStore.getState()._set(patch);
}

/** True when THIS message's TTS button should show the loading/playing state. */
export function ttsActiveFor(playing: boolean, origin: TTSOrigin, tabId: number | null, msgId: string | null): 'playing' | 'loading' | null {
  if (!playing) return null;
  if (origin.tabId !== tabId || origin.msgId !== msgId || !msgId) return null;
  return 'playing';
}
