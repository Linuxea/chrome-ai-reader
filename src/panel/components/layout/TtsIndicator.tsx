import { Volume2, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTTSStore } from '@/panel/stores/tts-store';
import { stopAllTTS, cycleTTSRate } from '@/panel/lib/tts-controller';
import { t } from '@/shared/i18n.js';

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Window-global TTS strip: the always-available status + stop control while
 * an answer is being read aloud (it keeps reading on other tabs). Rendered
 * in flow under the quick actions — never overlaying the header — and kept
 * to a single line (narrow-panel guard in CSS).
 */
export function TtsIndicator() {
  const playing = useTTSStore(s => s.playing);
  const audioStarted = useTTSStore(s => s.audioStarted);
  const progress = useTTSStore(s => s.progress);
  const rate = useTTSStore(s => s.rate);

  return (
    <AnimatePresence initial={false}>
      {playing && (
        <motion.div
          className="tts-indicator"
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <Volume2 size={13} className={`flex-shrink-0${audioStarted ? '' : ' tts-pulsing'}`} />
          <span className="tts-indicator-label">{t('tts.reading')}</span>
          {audioStarted && progress && (
            <span className="tts-indicator-progress">{fmt(progress.position)} / {fmt(progress.end)}</span>
          )}
          <button className="tts-rate" onClick={cycleTTSRate} title={t('tts.speed')}>
            {rate}×
          </button>
          <button className="tts-stop" onClick={stopAllTTS} title={t('tts.stop')} aria-label={t('tts.stop')}>
            <Square size={12} fill="currentColor" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
