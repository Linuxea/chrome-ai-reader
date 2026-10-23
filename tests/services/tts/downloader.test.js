import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../../src/shared/download.js', () => ({
  downloadFile: vi.fn(),
}));

// Deterministic cache seam: per-test controllable, no IndexedDB in jsdom.
vi.mock('../../../src/shared/tts-cache.js', () => ({
  ttsCacheKey: vi.fn(async (_voice, text) => `key:${text}`),
  getCachedSegmentAudio: vi.fn(async () => null),
  putSegmentAudio: vi.fn(async () => {}),
}));

import * as downloadMock from '../../../src/shared/download.js';
import * as cacheMock from '../../../src/shared/tts-cache.js';
import { splitToSegments } from '../../../src/side_panel/services/tts/utils.js';

// Mock chrome.runtime.connect with programmable port
const { createMockPort } = await import('../../helpers/chrome-mock.js');

// Track the latest port for each test
let currentPort = null;

vi.hoisted(() => {
  globalThis.chrome = {
    runtime: {
      connect: vi.fn(() => null),
    },
  };
});

import {
  initDownloader,
  stopTTSDownload,
  handleTTSDownloadClick,
  detachDownloadAnchor,
  reattachDownloadAnchor,
  getDownloadOrigin,
  isTTSDownloading,
} from '../../../src/side_panel/services/tts/downloader.js';

function encodeBase64(str) {
  return btoa(str);
}

/** Text that segments into exactly two segments under the deterministic rule. */
const TWO_SEGMENT_TEXT = '这是一句够长的话呀。'.repeat(12); // 132 chars → 66 + 66

async function waitForPort() {
  await vi.waitFor(() => {
    if (!currentPort || currentPort.postMessage.mock.calls.length === 0) throw new Error('port not ready');
  });
  return currentPort;
}

describe('TTS Downloader', () => {
  let chatArea;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.getCachedSegmentAudio.mockResolvedValue(null);
    currentPort = createMockPort('tts');
    chrome.runtime.connect = vi.fn(() => {
      currentPort = createMockPort('tts');
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
    it('cleans up state and resets the button of the message being downloaded', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Some text. More text.';
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      msgEl.appendChild(btn);
      chatArea.appendChild(msgEl);
      handleTTSDownloadClick(msgEl);
      expect(btn.disabled).toBe(true);

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

    it('returns early for text that strips to nothing (code block only)', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = '```\nconst x = 1;\n```';
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
      expect(isTTSDownloading()).toBe(false);
    });

    it('sets button to loading state', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Content with enough text. Second sentence. Third. Fourth. Fifth.';
      chatArea.appendChild(msgEl);

      // an unrelated earlier answer's button must stay untouched
      const otherBtn = document.createElement('button');
      otherBtn.className = 'tts-download-btn';
      chatArea.prepend(otherBtn);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      msgEl.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      expect(btn.classList.contains('tts-loading')).toBe(true);
      expect(btn.disabled).toBe(true);
      expect(otherBtn.classList.contains('tts-loading')).toBe(false);
    });

    it('prefers the markdown source, falling back to rendered text', async () => {
      const msgEl = document.createElement('div');
      msgEl.dataset.markdown = '**Bold** prose that is long enough to be spoken aloud properly.';
      const contentEl = document.createElement('div');
      contentEl.className = 'thinking-response-content';
      contentEl.textContent = 'rendered fallback';
      msgEl.appendChild(contentEl);
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      await vi.waitFor(() => {
        expect(chrome.runtime.connect).toHaveBeenCalled();
      });
      const port = chrome.runtime.connect.mock.results[0].value;
      await vi.waitFor(() => {
        // markdown stripped: markers gone, source text used — not the rendered one
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'tts',
          text: expect.stringContaining('Bold prose that is long enough'),
        });
        expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'rendered fallback' }));
      });
    });

    it('posts one request per segment to the tts port', async () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = TWO_SEGMENT_TEXT;
      chatArea.appendChild(msgEl);
      expect(splitToSegments(TWO_SEGMENT_TEXT).length).toBe(2);

      handleTTSDownloadClick(msgEl);
      await vi.waitFor(() => {
        expect(chrome.runtime.connect.mock.calls.length).toBe(2); // pipelined, not serial
      });
      expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'tts' });
    });

    it('skips the port entirely on a warm cache', async () => {
      cacheMock.getCachedSegmentAudio.mockImplementation(async (key) => {
        expect(typeof key).toBe('string');
        return new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
      });
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Cached content here. Second sentence. Third. Fourth. Fifth. Sixth.';
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      await vi.waitFor(() => {
        expect(downloadMock.downloadFile).toHaveBeenCalled();
      });
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
    });

    it('returns early if already downloading', () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = TWO_SEGMENT_TEXT;
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
    it('calls downloadFile with combined audio data on done', async () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);

      handleTTSDownloadClick(msgEl);
      const port = await waitForPort();

      port._simulateMessage({ type: 'chunk', data: encodeBase64('fake audio chunk') });
      port._simulateMessage({ type: 'done' });

      await vi.waitFor(() => {
        expect(downloadMock.downloadFile).toHaveBeenCalledWith(
          expect.any(Blob),
          expect.stringMatching(/^voice-.*\.mp3$/),
          'audio/mpeg',
        );
      });
    });

    it('resets button state after successful download', async () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);

      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      btn.innerHTML = '<svg></svg>'; // icon-only, like the real button (no text to read)
      msgEl.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      const port = await waitForPort();
      port._simulateMessage({ type: 'chunk', data: encodeBase64('audio') });
      port._simulateMessage({ type: 'done' });

      await vi.waitFor(() => {
        expect(btn.title).toBe('[action.downloaded]');
      });
    });

    it('stops download after the retry also fails (error path)', async () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      msgEl.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      const port1 = await waitForPort();
      port1._simulateMessage({ type: 'chunk', data: encodeBase64('audio') });
      port1._simulateMessage({ type: 'error', error: 'Failed' });

      // one retry (~300ms backoff), then the second failure stops the download
      await vi.waitFor(() => expect(chrome.runtime.connect.mock.calls.length).toBe(2), { timeout: 2000 });
      const port2 = chrome.runtime.connect.mock.results[1].value;
      port2._simulateMessage({ type: 'error', error: 'Failed again' });

      expect(btn.classList.contains('tts-loading')).toBe(false);
      expect(btn.disabled).toBe(false);
    });

    it('stops download after a retried disconnect also fails', async () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      msgEl.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      const port1 = await waitForPort();
      port1._simulateMessage({ type: 'chunk', data: encodeBase64('audio') });
      port1._simulateDisconnect();

      await vi.waitFor(() => expect(chrome.runtime.connect.mock.calls.length).toBe(2), { timeout: 2000 });
      const port2 = chrome.runtime.connect.mock.results[1].value;
      port2._simulateDisconnect();

      expect(btn.classList.contains('tts-loading')).toBe(false);
      expect(btn.disabled).toBe(false);
    });

    it('delivers multiple segments as one file, in order, pipelined', async () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = TWO_SEGMENT_TEXT;
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      msgEl.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      await vi.waitFor(() => expect(chrome.runtime.connect.mock.calls.length).toBe(2));

      // Ports resolve OUT OF ORDER — the engine must still deliver in order.
      const ports = chrome.runtime.connect.mock.results.map(r => r.value);
      ports[1]._simulateMessage({ type: 'chunk', data: encodeBase64('second-seg') });
      ports[1]._simulateMessage({ type: 'done' });
      ports[0]._simulateMessage({ type: 'chunk', data: encodeBase64('first-seg') });
      ports[0]._simulateMessage({ type: 'done' });

      await vi.waitFor(() => {
        expect(downloadMock.downloadFile).toHaveBeenCalled();
      });
      const blob = downloadMock.downloadFile.mock.calls[0][0];
      const text = await blob.text();
      expect(text).toBe('first-segsecond-seg');

      await vi.waitFor(() => {
        expect(cacheMock.putSegmentAudio).toHaveBeenCalledTimes(2);
      });
    });

    it('stops without download when no chunks received', async () => {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'Test. More. Text. Here. Done.';
      chatArea.appendChild(msgEl);
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      msgEl.appendChild(btn);

      handleTTSDownloadClick(msgEl);
      const port = await waitForPort();
      port._simulateMessage({ type: 'done' });

      await vi.waitFor(() => {
        expect(btn.classList.contains('tts-loading')).toBe(false);
      });
      expect(downloadMock.downloadFile).not.toHaveBeenCalled();
    });
  });

  describe('origin + detach / reattach (tab switch)', () => {
    function startDownload(msgId) {
      const msgEl = document.createElement('div');
      msgEl.textContent = 'A. B. C. D. E. F. G. H.';
      if (msgId) msgEl.dataset.msgId = msgId;
      const btn = document.createElement('button');
      btn.className = 'tts-download-btn';
      msgEl.appendChild(btn);
      chatArea.appendChild(msgEl);
      handleTTSDownloadClick(msgEl);
      return { msgEl, btn };
    }

    it('records the message id the download belongs to', () => {
      const { btn } = startDownload('m-3');
      expect(isTTSDownloading()).toBe(true);
      expect(getDownloadOrigin()).toEqual({ tabId: null, msgId: 'm-3' });
      expect(btn.classList.contains('tts-loading')).toBe(true);
    });

    it('detach keeps the download running but drops the button anchor', () => {
      const { btn } = startDownload('m-3');

      detachDownloadAnchor();

      expect(isTTSDownloading()).toBe(true);
      expect(btn.classList.contains('tts-loading')).toBe(true); // untouched orphan
    });

    it('reattach restores the loading state on the rebuilt button', () => {
      startDownload('m-3');
      detachDownloadAnchor();

      const fresh = document.createElement('button');
      fresh.className = 'tts-download-btn';
      reattachDownloadAnchor(fresh);

      expect(fresh.classList.contains('tts-loading')).toBe(true);
      expect(fresh.disabled).toBe(true);
      expect(fresh.title).toBe('[status.ttsDownloading]');
    });

    it('origin is cleared on stop', () => {
      startDownload('m-3');
      stopTTSDownload();
      expect(getDownloadOrigin()).toEqual({ tabId: null, msgId: null });
    });
  });
});
