import { useState } from 'react';
import { Copy, Check, Volume2, Download, Share2 } from 'lucide-react';
import { useTTSStore } from '@/panel/stores/tts-store';
import { handleTTSButtonClick, handleTTSDownloadClick } from '@/panel/lib/tts-controller';
import { t } from '@/shared/i18n.js';

/**
 * The action row under every finished answer: copy / TTS / download / share.
 * TTS button state is DERIVED from the window-global playback origin — no
 * DOM anchor, so tab switches / re-renders can never lose it.
 */
export function AnswerActions({ msgId, markdown, onShare }: { msgId: string; markdown: string; onShare?: () => void }) {
  const [copied, setCopied] = useState(false);
  const playing = useTTSStore(s => s.playing);
  const audioStarted = useTTSStore(s => s.audioStarted);
  const origin = useTTSStore(s => s.origin);
  const downloading = useTTSStore(s => s.downloading);

  const thisTTS = playing && origin.msgId === msgId;
  const thisDownloading = downloading?.msgId === msgId;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="answer-actions">
      <button className="answer-action" onClick={() => void copy()} title={copied ? t('action.copied') : t('action.copy')}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <button
        className={`answer-action${thisTTS ? (audioStarted ? ' tts-on' : ' tts-loading') : ''}`}
        onClick={() => handleTTSButtonClick({ tabId: origin.tabId, msgId, markdown })}
        title={t('action.tts')}
      >
        <Volume2 size={13} />
      </button>
      <button
        className={`answer-action${thisDownloading ? ' tts-loading' : ''}`}
        disabled={thisDownloading}
        onClick={() => handleTTSDownloadClick({ tabId: origin.tabId, msgId, markdown })}
        title={thisDownloading ? t('status.ttsDownloading') : t('action.ttsDownload')}
      >
        <Download size={13} />
      </button>
      {onShare && (
        <button className="answer-action" onClick={onShare} title={t('share.button')}>
          <Share2 size={13} />
        </button>
      )}
    </div>
  );
}
