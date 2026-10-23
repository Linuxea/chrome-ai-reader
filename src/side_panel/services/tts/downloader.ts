import { t } from '../../../shared/i18n.js';
import { downloadFile } from '../../../shared/download';
import { stripMarkdown, splitToSegments } from './utils';
import { TTSSynthEngine, getTTSVoice } from './engine';
import * as state from '../../state';

let ttsDownloadEngine: TTSSynthEngine | null = null;
let ttsDownloadChunks: ArrayBuffer[] = [];
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
  _originTabId = null;
  _originMsgId = null;

  ttsDownloadEngine?.abort();
  ttsDownloadEngine = null;

  const btn = _downloadBtn;
  _downloadBtn = null;
  if (btn) {
    btn.classList.remove('tts-loading');
    btn.disabled = false;
    btn.title = t('action.ttsDownload');
  }
}

function finishTTSDownload(): void {
  if (ttsDownloadChunks.length === 0) {
    stopTTSDownload();
    return;
  }

  const blob = new Blob(ttsDownloadChunks, { type: 'audio/mpeg' });
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
  _originTabId = null;
  _originMsgId = null;
}

export function handleTTSDownloadClick(msgEl: HTMLElement): void {
  if (ttsDownloading) return;

  const contentEl = msgEl.querySelector('.thinking-response-content');
  const source = msgEl.dataset.markdown || (contentEl ? contentEl.textContent : msgEl.textContent) || '';
  const cleaned = stripMarkdown(source);
  if (!cleaned.trim()) return;

  const segments = splitToSegments(cleaned);
  if (segments.length === 0) return;

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

  ttsDownloadEngine = new TTSSynthEngine({
    voice: getTTSVoice(),
    // No playback clock — synthesize at full speed (bounded by maxInflight).
    getBufferedAheadMs: () => 0,
    onHeadChunk: (bytes) => { ttsDownloadChunks.push(bytes); },
    onDrained: finishTTSDownload,
    onError: (msg) => {
      console.error('[TTS Download] error:', msg);
      stopTTSDownload();
    },
  });
  for (const seg of segments) ttsDownloadEngine.enqueue(seg);
  ttsDownloadEngine.endInput();
}
