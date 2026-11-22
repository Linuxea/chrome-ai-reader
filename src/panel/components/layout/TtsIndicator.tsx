import { Volume2, Square } from 'lucide-react';
import { useTTSStore } from '@/panel/stores/tts-store';
import { stopAllTTS, cycleTTSRate } from '@/panel/lib/tts-controller';
import { t } from '@/shared/i18n.js';

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Window-global TTS chip: the always-available status + stop control while
 * an answer is being read aloud (it keeps reading on other tabs).
 */
export function TtsIndicator() {
  const { playing, audioStarted, progress, rate } = useTTSStore();
  if (!playing) return null;
  return (
    <div className="tts-indicator" role="status">
      <Volume2 size={13} className={audioStarted ? '' : 'tts-pulsing'} />
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
    </div>
  );
}
