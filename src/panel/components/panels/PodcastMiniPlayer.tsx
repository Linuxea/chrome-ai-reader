/**
 * Podcast mini-player — the window-global face of a podcast session while
 * the user is on a tab OTHER than the origin tab (playing in background or
 * still generating). Mounted OUTSIDE the chat area (it must survive tab
 * switches, which re-render the message list); renders nothing on the
 * origin tab (the full card lives there) and when there is no session.
 */
import type { JSX } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Play, Pause, RotateCcw, Loader2, Mic } from 'lucide-react';
import { t } from '@/shared/i18n.js';
import { usePodcastStore, isPodcastStatusGenerating } from '@/panel/stores/podcast-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { stopPodcast, handlePlayPause, replayPodcast } from '@/panel/lib/podcast-controller';

export function PodcastMiniPlayer(): JSX.Element | null {
  const np = usePodcastStore(s => s.nowPlaying);
  const playing = usePodcastStore(s => s.playing);
  const activeTabId = useTabsStore(s => s.activeTabId);

  const visible = !!np && np.originTabId !== activeTabId;
  // No session at all → not even the (exit-animating) wrapper is needed.
  if (!np && !visible) return null;

  const generating = !!np && isPodcastStatusGenerating(np.status);

  const onPlayClick = () => {
    if (!np || generating) return;
    // Replay from the start when playback had finished.
    if (np.status === 'done') {
      replayPodcast();
      return;
    }
    handlePlayPause();
  };

  return (
    <AnimatePresence initial={false}>
      {visible && np && (
        <motion.div
          key="podcast-mini"
          className="podcast-mini mx-2 mb-1.5 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-sm"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18 }}
        >
          {generating ? (
            <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Mic size={14} className="shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs">
            {generating ? t('podcast.miniGenerating') : (np.title || t('podcast.cardTitle'))}
          </span>
          <button
            type="button"
            className="podcast-mini-play-btn flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:opacity-40"
            disabled={generating}
            title={np.status === 'done' ? t('podcast.replay') : (playing ? t('podcast.pause') : t('podcast.play'))}
            onClick={onPlayClick}
          >
            {generating ? (
              <span className="size-[11px]" />
            ) : np.status === 'done' ? (
              <RotateCcw size={11} />
            ) : playing ? (
              <Pause size={11} />
            ) : (
              <Play size={11} />
            )}
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            title={t('podcast.close')}
            onClick={() => stopPodcast()}
          >
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
