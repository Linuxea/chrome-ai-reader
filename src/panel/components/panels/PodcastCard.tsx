/**
 * Podcast card — the F13 podcast surface on the ORIGIN tab: dual-speaker
 * transcript with live highlight, play/pause, progress seeking, replay and
 * download. Rendered purely from podcast-store (the React port of the
 * legacy card DOM + its reattachment tricks): returning to the origin tab
 * simply re-renders it from `nowPlaying` — no rebuild event needed — and
 * switching away keeps the audio playing (other tabs show the mini-player).
 *
 * Returns null when there is no session or the active tab is not the
 * origin tab. Mount it below the message list.
 */
import { useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'motion/react';
import { Podcast as PodcastIcon, X, Play, Pause, Download, RotateCcw, Loader2 } from 'lucide-react';
import { t } from '@/shared/i18n.js';
import { formatDuration } from '@/shared/format';
import { usePodcastStore, isPodcastStatusGenerating, type NowPlaying } from '@/panel/stores/podcast-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import {
  stopPodcast,
  handlePlayPause,
  seekToRatio,
  replayPodcast,
  downloadPodcastAudio,
  retryPodcast,
  roundIndexAt,
} from '@/panel/lib/podcast-controller';

/** Rounds shown before the "show transcript" toggle (legacy COLLAPSED_LIMIT). */
const COLLAPSED_LIMIT = 4;

export function PodcastCard(): JSX.Element | null {
  const np = usePodcastStore(s => s.nowPlaying);
  const activeTabId = useTabsStore(s => s.activeTabId);
  if (!np || np.originTabId !== activeTabId) return null;
  return <PodcastCardBody np={np} />;
}

function PodcastCardBody({ np }: { np: NowPlaying }) {
  const playing = usePodcastStore(s => s.playing);
  const currentTime = usePodcastStore(s => s.currentTime);
  const duration = usePodcastStore(s => s.duration);
  const roundTimings = usePodcastStore(s => s.roundTimings);
  const hasAudio = usePodcastStore(s => s.hasAudio);

  const [expanded, setExpanded] = useState(false);
  const activeRoundRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const generating = isPodcastStatusGenerating(np.status);
  const activeRound = generating ? -1 : roundIndexAt(currentTime, roundTimings);

  // Legacy parity: the transcript auto-expands when the spoken round is
  // inside the collapsed tail, and the active round scrolls into view.
  useEffect(() => {
    if (activeRound >= COLLAPSED_LIMIT && !expanded) setExpanded(true);
  }, [activeRound, expanded]);
  useEffect(() => {
    activeRoundRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [activeRound]);

  const ratio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  const seekFromPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekToRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  const visibleRounds = expanded ? np.script : np.script.slice(0, COLLAPSED_LIMIT);

  return (
    <motion.div
      className="podcast-card flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 text-sm"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <PodcastIcon size={15} />
          {t('podcast.cardTitle')}
        </span>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          title={t('podcast.close')}
          onClick={() => stopPodcast()}
        >
          <X size={14} />
        </button>
      </div>

      {np.title && (
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-semibold leading-snug">{np.title}</h3>
          {np.description && <p className="text-xs text-muted-foreground">{np.description}</p>}
        </div>
      )}

      {np.sourcePreview && (
        <blockquote className="podcast-quote border-l-2 border-border pl-2 text-xs text-muted-foreground">
          {np.sourcePreview}
        </blockquote>
      )}

      {np.script.length > 0 && (
        <div className="podcast-transcript flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1 text-xs leading-relaxed">
          {visibleRounds.map((round, idx) => (
            <div
              key={idx}
              ref={idx === activeRound ? activeRoundRef : null}
              className={
                'flex gap-1.5 rounded px-1.5 py-1 transition-colors ' +
                (idx === activeRound ? 'bg-muted' : '')
              }
            >
              <span
                className={
                  'mt-px h-fit shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ' +
                  (round.speakerLabel === 'A' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground')
                }
              >
                {round.speakerLabel}
              </span>
              <span className="min-w-0 break-words">{round.text}</span>
            </div>
          ))}
          {np.script.length > COLLAPSED_LIMIT && (
            <button
              type="button"
              className="podcast-transcript-toggle self-start text-xs text-primary hover:underline"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? t('podcast.showLess') : t('podcast.showMore')}
            </button>
          )}
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          <span>{np.status === 'generating_script' ? t('podcast.generatingScript') : t('podcast.generatingAudio')}</span>
        </div>
      )}

      {np.status === 'error' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-destructive">{np.statusText || t('podcast.error')}</span>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 transition-colors hover:bg-secondary"
            onClick={() => void retryPodcast()}
          >
            {t('podcast.retry')}
          </button>
        </div>
      )}

      {np.status === 'done' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t('podcast.done')}</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 transition-colors hover:bg-secondary"
            onClick={() => replayPodcast()}
          >
            <RotateCcw size={12} />
            {t('podcast.replay')}
          </button>
          {hasAudio && (
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-border px-2 py-0.5 transition-colors hover:bg-secondary"
              onClick={() => downloadPodcastAudio()}
            >
              <Download size={12} />
              {t('podcast.download')}
            </button>
          )}
        </div>
      )}

      {np.status === 'playing' && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="podcast-play-btn flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85"
            title={playing ? t('podcast.pause') : t('podcast.play')}
            onClick={() => handlePlayPause()}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <div
            ref={barRef}
            className="podcast-progress relative h-4 flex-1 cursor-pointer touch-none select-none"
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFromPointer(e);
            }}
            onPointerMove={e => {
              if (e.buttons > 0) seekFromPointer(e);
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border" />
            <div
              className="podcast-progress-fill absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
              style={{ width: `${ratio * 100}%` }}
            />
            <div
              className="podcast-progress-thumb pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
              style={{ left: `${ratio * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          {hasAudio && (
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              title={t('podcast.download')}
              onClick={() => downloadPodcastAudio()}
            >
              <Download size={13} />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
