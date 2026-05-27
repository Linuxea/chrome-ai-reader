// tts/index.js — Barrel + orchestration for TTS modules

import { t } from '../../../shared/i18n.js';
import { splitToSegments } from './utils.js';
import {
  initPlayer, setFullStopFn, setTTSAutoPlay,
  isTTSPlaying as _isTTSPlaying,
  isTTSAutoPlay as _isTTSAutoPlay,
  initTTSPlayback as _initTTSPlayback,
  ttsAppendChunk as _ttsAppendChunk,
  ttsEnqueue, ttsFlushRemaining, stopTTSPlayback,
} from './player.js';
import { initDownloader, stopTTSDownload, handleTTSDownloadClick } from './downloader.js';

let _chatArea;

export function initTTS({ chatArea }) {
  _chatArea = chatArea;

  initPlayer(chatArea);
  initDownloader(chatArea);

  setFullStopFn(stopTTS);

  chrome.storage.sync.get(['ttsAutoPlay'], (data) => {
    setTTSAutoPlay(data.ttsAutoPlay === true);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.ttsAutoPlay) {
      setTTSAutoPlay(changes.ttsAutoPlay.newValue === true);
    }
  });
}

export function isTTSPlaying() { return _isTTSPlaying(); }
export function isTTSAutoPlay() { return _isTTSAutoPlay(); }

export function stopTTS() {
  stopTTSDownload();
  stopTTSPlayback();

  const btn = _chatArea.querySelector('.tts-btn');
  if (btn) {
    btn.classList.remove('tts-playing', 'tts-loading');
  }
}

export { _initTTSPlayback as initTTSPlayback };
export { _ttsAppendChunk as ttsAppendChunk };

/**
 * TTS 按钮点击处理（toggle 行为）
 */
function handleTTSButtonClick(msgEl) {
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

/**
 * 在 AI 消息上添加 TTS + 复制按钮
 */
export function addTTSButton(msgEl) {
  const prevTts = _chatArea.querySelector('.tts-btn');
  if (prevTts) prevTts.remove();
  const prevDownload = _chatArea.querySelector('.tts-download-btn');
  if (prevDownload) prevDownload.remove();
  const prevCopy = _chatArea.querySelector('.ai-action-btn');
  if (prevCopy) prevCopy.remove();

  // 复制按钮
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ai-action-btn';
  copyBtn.title = t('action.copy');
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  copyBtn.addEventListener('click', () => {
    const contentEl = msgEl.querySelector('.thinking-response-content');
    const text = contentEl ? contentEl.textContent : msgEl.textContent;
    if (text && text.trim()) {
      navigator.clipboard.writeText(text.trim()).then(() => {
        copyBtn.title = t('action.copied');
        setTimeout(() => { copyBtn.title = t('action.copy'); }, 1500);
      });
    }
  });

  msgEl.appendChild(copyBtn);

  // TTS 按钮
  const btn = document.createElement('button');
  btn.className = 'tts-btn';
  btn.title = t('action.tts');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

  btn.addEventListener('click', () => handleTTSButtonClick(msgEl));

  msgEl.appendChild(btn);

  // TTS Download button
  const dlBtn = document.createElement('button');
  dlBtn.className = 'tts-download-btn';
  dlBtn.title = t('action.ttsDownload');
  dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

  dlBtn.addEventListener('click', () => handleTTSDownloadClick(msgEl));

  msgEl.appendChild(dlBtn);
}

/**
 * AI done 且 ttsAutoPlayEnabled 时调用，启动流式自动播放
 */
export function initTTSAutoPlay(msgEl) {
  if (!_isTTSAutoPlay()) return;
  if (!_isTTSPlaying()) return;

  ttsFlushRemaining();
}
