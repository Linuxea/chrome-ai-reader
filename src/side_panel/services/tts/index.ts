import { t } from '../../../shared/i18n.js';
import { CSS } from '../../../shared/css-selectors';
import { onSyncChange } from '../../../platform/storage';
import { createTTSButtons } from '../../ui/tts-buttons';
import { splitToSegments } from './utils';
import {
  initPlayer, setFullStopFn, setTTSAutoPlay,
  isTTSPlaying as _isTTSPlaying,
  isTTSAutoPlay as _isTTSAutoPlay,
  initTTSPlayback as _initTTSPlayback,
  ttsAppendChunk as _ttsAppendChunk,
  ttsEnqueue, ttsFlushRemaining, stopTTSPlayback,
} from './player';
import { initDownloader, stopTTSDownload, handleTTSDownloadClick } from './downloader';

let _chatArea: HTMLElement;

export function initTTS({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;

  initPlayer(chatArea);
  initDownloader(chatArea);

  setFullStopFn(stopTTS);

  chrome.storage.sync.get(['ttsAutoPlay'], (data) => {
    setTTSAutoPlay(data.ttsAutoPlay === true);
  });

  onSyncChange('ttsAutoPlay', (newValue) => {
    setTTSAutoPlay(newValue === true);
  });
}

export function isTTSPlaying(): boolean { return _isTTSPlaying(); }
export function isTTSAutoPlay(): boolean { return _isTTSAutoPlay(); }

export function stopTTS(): void {
  stopTTSDownload();
  stopTTSPlayback();

  const btn = _chatArea.querySelector(CSS.TTS_BTN);
  if (btn) {
    btn.classList.remove(CSS.TTS_PLAYING.replace('.', ''), CSS.TTS_LOADING.replace('.', ''));
  }
}

export { _initTTSPlayback as initTTSPlayback };
export { _ttsAppendChunk as ttsAppendChunk };

function handleTTSButtonClick(msgEl: HTMLElement): void {
  if (_isTTSPlaying()) {
    stopTTS();
    return;
  }

  const contentEl = msgEl.querySelector('.thinking-response-content');
  const text = contentEl ? contentEl.textContent : msgEl.textContent;
  if (!text || !text.trim()) return;

  _initTTSPlayback();
  const segments = splitToSegments(text.trim());
  segments.forEach(seg => ttsEnqueue(seg));
}

export function addTTSButton(msgEl: HTMLElement): void {
  createTTSButtons(msgEl, {
    onToggleTTS: handleTTSButtonClick,
    onDownload: handleTTSDownloadClick,
  });
}

export function initTTSAutoPlay(): void {
  if (!_isTTSAutoPlay()) return;
  if (!_isTTSPlaying()) return;

  ttsFlushRemaining();
}
