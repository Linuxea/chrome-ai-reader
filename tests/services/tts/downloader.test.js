import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../../src/shared/download.js', () => ({
  downloadFile: vi.fn(),
}));

import * as downloadMock from '../../../src/shared/download.js';

// Mock chrome.runtime.connect with programmable port
const { createMockPort } = await import('../../helpers/chrome-mock.js');

// Track the latest port for each test
let currentPort = null;

vi.hoisted(() => {
  globalThis.chrome = {
    runtime: {
      connect: vi.fn(() => {
        // This will be overridden in beforeEach
        return null;
      }),
    },
  };
});

import {
  initDownloader,
  stopTTSDownload,
  handleTTSDownloadClick,
} from '../../../src/side_panel/services/tts/downloader.js';

function encodeBase64(str) {
  return btoa(str);
}

describe('TTS Downloader', () => {
  let chatArea;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore chrome.runtime.connect to return a fresh mock port
    currentPort = createMockPort('tts-download');
    chrome.runtime.connect = vi.fn(() => {
      currentPort = createMockPort('tts-download');
      return currentPort;
    });

    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);
    initDownloader(chatArea);
    // Reset internal downloading state between tests
    stopTTSDownload();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('initDownloader', () => {
    it('stores chatArea reference', () => {
      expect(() => initDownloader(chatArea)).not.toThrow();
    });
  });

  describe('stopTTSDownload', () => {
    it('cleans up state and resets button', () => {
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      btn.classList.add('tts-loading');
      btn.disabled = true;
      chatArea.appendChild(btn);

      stopTTSDownload();

      expect(btn.classList.contains('tts-loading')).toBe(false);
      expect(btn.disabled).toBe(false);
    });

    it('handles missing button gracefully', () => {
      expect(() => stopTTSDownload()).not.toThrow();
    });
  });

  describe('handleTTSDownloadClick', () => {
    it('returns early for empty text content', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = '';
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
    });

    it('returns early for whitespace-only text', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = '   ';
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
    });

    it('sets button to loading state', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Content with enough text. Second sentence. Third. Fourth. Fifth.';
      chatArea.appendChild(msgEl);

      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      chatArea.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      expect(btn.classList.contains('tts-loading')).toBe(true);
      expect(btn.disabled).toBe(true);
    });

    it('connects to tts-download port and posts message', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Content. More. Even more. And more. Last one here.';
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'tts-download' });
      expect(currentPort.postMessage).toHaveBeenCalledWith({
        type: 'tts',
        text: expect.any(String),
      });
    });

    it('prefers thinking-response-content text over msgEl text', () => {
      const msgEl = document.createElement('div');
      const contentEl = document.createElement('div');
      contentEl.className = 'thinking-response-content';
      contentEl.textContent = 'Inner content. Second. Third. Fourth. Fifth.';
      msgEl.appendChild(contentEl);
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      expect(currentPort.postMessage).toHaveBeenCalledWith({
        type: 'tts',
        text: 'Inner content. Second. Third. Fourth. Fifth.',
      });
    });

    it('returns early if already downloading', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'A. B. C. D. E. F. G. H. I. J.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      chatArea.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      const callCount = chrome.runtime.connect.mock.calls.length;
      handleTTSDownloadClick(msgEl);
      expect(chrome.runtime.connect.mock.calls.length).toBe(callCount);
    });
  });

  describe('download completion', () => {
    it('calls downloadFile with combined audio data on done', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      const port = currentPort;

      const audioData = encodeBase64('fake audio chunk');
      port._simulateMessage({ type: 'chunk', data: audioData });
      port._simulateMessage({ type: 'done' });

      expect(downloadMock.downloadFile).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^voice-.*\.mp3$/),
        'audio/mpeg',
      );
    });

    it('resets button state after successful download', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);

      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      btn.innerHTML = '<span>original</span>';
      chatArea.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      currentPort._simulateMessage({ type: 'chunk', data: encodeBase64('audio') });
      currentPort._simulateMessage({ type: 'done' });

      expect(btn.title).toBe('[action.copied]');
    });

    it('stops download on error message', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      chatArea.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      currentPort._simulateMessage({ type: 'error', error: 'Failed' });

      expect(btn.classList.contains('tts-loading')).toBe(false);
      expect(btn.disabled).toBe(false);
    });

    it('stops download on port disconnect', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      chatArea.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      currentPort._simulateDisconnect();

      expect(btn.classList.contains('tts-loading')).toBe(false);
      expect(btn.disabled).toBe(false);
    });

    it('handles multiple segments sequentially', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'A. B. C. D. E. F. G. H. I. J.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      chatArea.appendChild(btn);

      handleTTSDownloadClick(msgEl);

      // First segment port
      const port1 = currentPort;
      port1._simulateMessage({ type: 'chunk', data: encodeBase64('chunk1') });
      port1._simulateMessage({ type: 'done' });

      // Should have started second segment — new port
      expect(chrome.runtime.connect.mock.calls.length).toBe(2);

      // Second segment port
      const port2 = currentPort;
      port2._simulateMessage({ type: 'chunk', data: encodeBase64('chunk2') });
      port2._simulateMessage({ type: 'done' });

      expect(downloadMock.downloadFile).toHaveBeenCalled();
    });

    it('stops without download when no chunks received', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      chatArea.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      currentPort._simulateMessage({ type: 'done' });

      expect(downloadMock.downloadFile).not.toHaveBeenCalled();
      expect(btn.classList.contains('tts-loading')).toBe(false);
    });
  });
});
