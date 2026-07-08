/**
 * Persistent mini-player for cross-tab background podcast playback.
 *
 * Lives outside `chatArea` so it survives tab-switch re-renders. Subscribes to
 * the window-global now-playing registry for visibility/title/status, and to
 * the audio element's play/pause state for the button icon. Always reflects
 * the single active podcast stream regardless of which tab is shown.
 */
import { t } from '../../../shared/i18n.js';
import { subscribeNowPlaying, getNowPlaying, type NowPlaying } from './now-playing';
import { onPodcastPlayState, isPodcastAudioPlaying, handlePlayPause, replayAudio } from './audio';
import { closePodcast } from './index';

let _root: HTMLElement | null = null;
let _titleEl: HTMLElement | null = null;
let _iconEl: HTMLElement | null = null;
let _playBtn: HTMLButtonElement | null = null;

const PLAY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const PAUSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

function isGenerating(np: NowPlaying): boolean {
  return np.status === 'generating_script' || np.status === 'generating_audio';
}

function render(np: NowPlaying | null): void {
  if (!_root) return;
  if (!np) {
    _root.classList.add('hidden');
    return;
  }
  _root.classList.remove('hidden');

  if (_titleEl) {
    const generating = isGenerating(np);
    _titleEl.textContent = generating
      ? t('podcast.miniGenerating')
      : (np.title || t('podcast.cardTitle'));
  }

  if (_iconEl) {
    _iconEl.innerHTML = isGenerating(np)
      ? `<span class="podcast-mini-spinner"></span>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
  }

  if (_playBtn) {
    const generating = isGenerating(np);
    _playBtn.disabled = generating;
    if (!generating) {
      _playBtn.innerHTML = isPodcastAudioPlaying() ? PAUSE_SVG : PLAY_SVG;
      _playBtn.title = isPodcastAudioPlaying() ? t('podcast.pause') : t('podcast.play');
    } else {
      _playBtn.innerHTML = '';
    }
  }
}

function onPlayClick(): void {
  const np = getNowPlaying();
  if (!np || isGenerating(np)) return;
  if (np.status === 'done') {
    // Replay from start when playback had finished.
    replayAudio(null);
    return;
  }
  handlePlayPause();
}

export function initMiniPlayer(): void {
  _root = document.getElementById('podcastMiniPlayer');
  _titleEl = _root?.querySelector('.podcast-mini-title') ?? null;
  _iconEl = _root?.querySelector('.podcast-mini-icon') ?? null;
  _playBtn = (_root?.querySelector('.podcast-mini-play-btn') as HTMLButtonElement | null) ?? null;

  _playBtn?.addEventListener('click', onPlayClick);
  _root?.querySelector('.podcast-mini-close')?.addEventListener('click', () => closePodcast());

  subscribeNowPlaying(render);
  onPodcastPlayState(() => render(getNowPlaying()));

  render(getNowPlaying());
}
