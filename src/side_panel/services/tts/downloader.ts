import { t } from '../../../shared/i18n.js';
import { downloadFile } from '../../../shared/download';
import { splitToSegments } from './utils';
import { openTTSDownloadPort } from '../../../platform/ports';
import * as state from '../../state';


let ttsDownloadPort: chrome.runtime.Port | null = null;
let ttsDownloadChunks: string[] = [];
let ttsDownloadSegments: string[] = [];
let ttsDownloadSegmentIndex = 0;
let ttsDownloadSending = false;
let ttsDownloading = false;
/** The download button of the message being downloaded. */
let _downloadBtn: HTMLButtonElement | null = null;

// --- Window-global download identity (mirrors player.ts origin tracking) ---

export interface TTSDownloadOrigin {
  tabId: number | null;
  msgId: string | null;
}

let _originTabId: number | null = null;
let _originMsgId: string | null = null;

export function getDownloadOrigin(): TTSDownloadOrigin {
  return { tabId: _originTabId, msgId: _originMsgId };
}

export function isTTSDownloading(): boolean { return ttsDownloading; }

/**
 * Tab switch / chat rebuild: the anchored bubble is about to be discarded —
 * drop the button reference. The download itself keeps running.
 */
export function detachDownloadAnchor(): void {
  _downloadBtn = null;
}

/** Re-bind a rebuilt card's button (tab switched back); restore its state. */
export function reattachDownloadAnchor(btn: HTMLButtonElement | null): void {
  _downloadBtn = btn;
  if (btn && ttsDownloading) {
    btn.classList.add('tts-loading');
    btn.disabled = true;
    btn.title = t('status.ttsDownloading');
  }
}

/** Kept for the init contract; the downloader holds no chat-area reference. */
export function initDownloader(_chatArea: HTMLElement): void {}

export function stopTTSDownload(): void {
  ttsDownloading = false;
  ttsDownloadChunks = [];
  ttsDownloadSegments = [];
  ttsDownloadSegmentIndex = 0;
  ttsDownloadSending = false;
  _originTabId = null;
  _originMsgId = null;

  if (ttsDownloadPort) {
    try { ttsDownloadPort.disconnect(); } catch { /* cleanup */ }
    ttsDownloadPort = null;
  }

  const btn = _downloadBtn;
  _downloadBtn = null;
  if (btn) {
    btn.classList.remove('tts-loading');
    btn.disabled = false;
    btn.title = t('action.ttsDownload');
  }
}

function ttsDownloadFlush(): void {
  if (ttsDownloadSending || ttsDownloadSegmentIndex >= ttsDownloadSegments.length || !ttsDownloading) return;

  ttsDownloadSending = true;
  const segment = ttsDownloadSegments[ttsDownloadSegmentIndex];
  ttsDownloadSegmentIndex++;

  ttsDownloadPort = openTTSDownloadPort();

  ttsDownloadPort.onDisconnect.addListener(() => {
    if (ttsDownloading) stopTTSDownload();
  });

  ttsDownloadPort.onMessage.addListener((msg: { type: string; data?: string; error?: string }) => {
    if (msg.type === 'chunk') {
      if (!msg.data) return;
      ttsDownloadChunks.push(msg.data);
    } else if (msg.type === 'done') {
      ttsDownloadSending = false;
      try { ttsDownloadPort?.disconnect(); } catch { /* cleanup */ }
      ttsDownloadPort = null;

      if (ttsDownloadSegmentIndex < ttsDownloadSegments.length) {
        ttsDownloadFlush();
      } else {
        finishTTSDownload();
      }
    } else if (msg.type === 'error') {
      console.error('[TTS Download] error:', msg.error);
      stopTTSDownload();
    }
  });

  ttsDownloadPort.postMessage({ type: 'tts', text: segment });
}

function finishTTSDownload(): void {
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

  const btn = _downloadBtn;
  _downloadBtn = null;
  if (btn) {
    btn.classList.remove('tts-loading');
    btn.disabled = false;
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    btn.title = t('action.downloaded');
    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.title = t('action.ttsDownload');
    }, 1500);
  }

  ttsDownloading = false;
  ttsDownloadChunks = [];
  ttsDownloadSegments = [];
  ttsDownloadSegmentIndex = 0;
  _originTabId = null;
  _originMsgId = null;
}

export function handleTTSDownloadClick(msgEl: HTMLElement): void {
  if (ttsDownloading) return;

  const contentEl = msgEl.querySelector('.thinking-response-content');
  const text = contentEl ? contentEl.textContent : msgEl.textContent;
  if (!text || !text.trim()) return;

  // Remember where this download came from so a tab-switch rebuild can
  // re-attach the button state (see reattachDownloadAnchor).
  _originTabId = state.getActiveTabId();
  _originMsgId = msgEl.dataset.msgId ?? null;

  // The clicked message's own button — not the first one in the chat.
  const btn = msgEl.querySelector('.tts-download-btn') as HTMLButtonElement | null;
  _downloadBtn = btn;
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
