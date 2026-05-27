// tts/downloader.js — Batch TTS download via segmented port connections

import { t } from '../../../shared/i18n.js';
import { downloadFile } from '../../../shared/download.js';
import { splitToSegments } from './utils.js';

let _chatArea;

let ttsDownloadPort = null;
let ttsDownloadChunks = [];
let ttsDownloadSegments = [];
let ttsDownloadSegmentIndex = 0;
let ttsDownloadSending = false;
let ttsDownloading = false;

export function initDownloader(chatArea) {
  _chatArea = chatArea;
}

/**
 * 停止 TTS 下载
 */
export function stopTTSDownload() {
  ttsDownloading = false;
  ttsDownloadChunks = [];
  ttsDownloadSegments = [];
  ttsDownloadSegmentIndex = 0;
  ttsDownloadSending = false;

  if (ttsDownloadPort) {
    try { ttsDownloadPort.disconnect(); } catch {}
    ttsDownloadPort = null;
  }

  const btn = _chatArea.querySelector('.tts-download-btn');
  if (btn) {
    btn.classList.remove('tts-loading');
    btn.disabled = false;
  }
}

function ttsDownloadFlush() {
  if (ttsDownloadSending || ttsDownloadSegmentIndex >= ttsDownloadSegments.length || !ttsDownloading) return;

  ttsDownloadSending = true;
  const segment = ttsDownloadSegments[ttsDownloadSegmentIndex];
  ttsDownloadSegmentIndex++;

  ttsDownloadPort = chrome.runtime.connect({ name: 'tts-download' });

  ttsDownloadPort.onDisconnect.addListener(() => {
    if (ttsDownloading) stopTTSDownload();
  });

  ttsDownloadPort.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      if (!msg.data) return;
      ttsDownloadChunks.push(msg.data);
    } else if (msg.type === 'done') {
      ttsDownloadSending = false;
      try { ttsDownloadPort.disconnect(); } catch {}
      ttsDownloadPort = null;

      if (ttsDownloadSegmentIndex < ttsDownloadSegments.length) {
        ttsDownloadFlush();
      } else {
        finishTTSDownload();
      }
    } else if (msg.type === 'error') {
      console.error('[TTS Download] error:', msg.error || msg.errorKey);
      stopTTSDownload();
    }
  });

  ttsDownloadPort.postMessage({ type: 'tts', text: segment });
}

function finishTTSDownload() {
  if (ttsDownloadChunks.length === 0) {
    stopTTSDownload();
    return;
  }

  const totalLength = ttsDownloadChunks.reduce((sum, chunk) => {
    const binary = atob(chunk);
    return sum + binary.length;
  }, 0);

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of ttsDownloadChunks) {
    const binary = atob(chunk);
    for (let i = 0; i < binary.length; i++) {
      result[offset++] = binary.charCodeAt(i);
    }
  }

  const blob = new Blob([result], { type: 'audio/mpeg' });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadFile(blob, `voice-${timestamp}.mp3`, 'audio/mpeg');

  const btn = _chatArea.querySelector('.tts-download-btn');
  if (btn) {
    btn.classList.remove('tts-loading');
    btn.disabled = false;
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    btn.title = t('action.copied');
    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.title = t('action.ttsDownload');
    }, 1500);
  }

  ttsDownloading = false;
  ttsDownloadChunks = [];
  ttsDownloadSegments = [];
  ttsDownloadSegmentIndex = 0;
}

/**
 * TTS 下载按钮点击处理
 */
export function handleTTSDownloadClick(msgEl) {
  if (ttsDownloading) return;

  const contentEl = msgEl.querySelector('.thinking-response-content');
  const text = contentEl ? contentEl.textContent : msgEl.textContent;
  if (!text || !text.trim()) return;

  const btn = _chatArea.querySelector('.tts-download-btn');
  if (btn) {
    btn.classList.add('tts-loading');
    btn.disabled = true;
    btn.title = t('status.ttsDownloading');
  }

  ttsDownloading = true;
  ttsDownloadChunks = [];
  ttsDownloadSegmentIndex = 0;
  ttsDownloadSending = false;
  ttsDownloadSegments = splitToSegments(text.trim());

  if (ttsDownloadSegments.length === 0) {
    stopTTSDownload();
    return;
  }

  ttsDownloadFlush();
}
