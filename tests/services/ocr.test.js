import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key, params) => {
    if (key === 'ai.ocrContext' && params) return `Image ${params.n}:\n`;
    return `[${key}]`;
  },
}));

vi.mock('../../src/shared/constants.js', () => ({
  escapeHtml: (text) => text,
}));

vi.mock('../../src/side_panel/state.js', () => ({
  getImageIndex: vi.fn(() => 0),
  setImageIndex: vi.fn(),
  getOcrResults: vi.fn(() => []),
  setOcrResults: vi.fn(),
  getOcrRunning: vi.fn(() => 0),
  setOcrRunning: vi.fn(),
}));

vi.mock('../../src/platform/storage.js', () => ({
  getSync: vi.fn(() => Promise.resolve({})),
}));

// Chrome mock
vi.hoisted(() => {
  globalThis.chrome = {
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve({ success: true, data: {} })),
    },
  };
});

import * as stateMock from '../../src/side_panel/state.js';
import { getSync } from '../../src/platform/storage.js';
import {
  initOCR,
  runOCR,
  ingestImages,
  addImageDataUri,
  buildOcrContext,
  hasImageErrors,
  getOcrRunning,
} from '../../src/side_panel/services/ocr.js';

describe('OCR service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateMock.getOcrResults.mockReturnValue([]);
    stateMock.getOcrRunning.mockReturnValue(0);
    stateMock.getImageIndex.mockReturnValue(0);
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, data: {} });

    // Set up DOM elements BEFORE calling initOCR
    document.body.innerHTML = `
      <button id="imageUploadBtn"></button>
      <input id="imageFileInput" type="file" />
      <div id="imagePreviewBar" class="hidden"></div>
    `;

    // Initialize OCR so internal _imagePreviewBar is set
    initOCR();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('buildOcrContext', () => {
    it('returns empty string when no OCR results', () => {
      stateMock.getOcrResults.mockReturnValue([]);
      expect(buildOcrContext()).toBe('');
    });

    it('returns formatted context for single OCR result', () => {
      stateMock.getOcrResults.mockReturnValue([
        { index: 1, fileName: 'img1.png', text: 'Hello world' },
      ]);
      const ctx = buildOcrContext();
      expect(ctx).toContain('Image 1');
      expect(ctx).toContain('Hello world');
    });

    it('sorts results by index and formats multiple', () => {
      stateMock.getOcrResults.mockReturnValue([
        { index: 3, fileName: 'c.png', text: 'Third' },
        { index: 1, fileName: 'a.png', text: 'First' },
        { index: 2, fileName: 'b.png', text: 'Second' },
      ]);
      const ctx = buildOcrContext();
      expect(ctx).toContain('Image 1');
      expect(ctx).toContain('Image 2');
      expect(ctx).toContain('Image 3');
      expect(ctx.indexOf('First')).toBeLessThan(ctx.indexOf('Second'));
      expect(ctx.indexOf('Second')).toBeLessThan(ctx.indexOf('Third'));
    });
  });

  describe('hasImageErrors', () => {
    it('returns false when no error elements exist', () => {
      expect(hasImageErrors()).toBe(false);
    });

    it('returns true when error elements exist', () => {
      const bar = document.getElementById('imagePreviewBar');
      const item = document.createElement('div');
      item.className = 'image-preview-item error';
      bar.appendChild(item);
      expect(hasImageErrors()).toBe(true);
    });
  });

  describe('getOcrRunning', () => {
    it('delegates to state.getOcrRunning', () => {
      stateMock.getOcrRunning.mockReturnValue(3);
      expect(getOcrRunning()).toBe(3);
    });
  });

  describe('runOCR', () => {
    function addPreviewItem(index) {
      const bar = document.getElementById('imagePreviewBar');
      const item = document.createElement('div');
      item.className = 'image-preview-item';
      item.dataset.index = String(index);
      item.innerHTML = '<span class="image-status loading"></span>';
      bar.appendChild(item);
      return item;
    }

    it('handles successful OCR with md_results', async () => {
      addPreviewItem(1);
      chrome.runtime.sendMessage.mockResolvedValue({
        success: true,
        data: { md_results: 'Extracted text from image' },
      });

      await runOCR(1, 'test.png', 'data:image/png;base64,abc');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'ocrParse',
        file: 'data:image/png;base64,abc',
      });
      expect(stateMock.setOcrResults).toHaveBeenCalled();
    });

    it('handles successful OCR with content_list', async () => {
      addPreviewItem(2);
      chrome.runtime.sendMessage.mockResolvedValue({
        success: true,
        data: {
          content_list: [
            { text: 'Line 1' },
            { text: 'Line 2' },
            { text: '  ' },
          ],
        },
      });

      await runOCR(2, 'test2.png', 'data:image/png;base64,def');

      const results = stateMock.setOcrResults.mock.calls[0][0];
      expect(results[0].text).toBe('Line 1\nLine 2');
    });

    it('handles successful OCR with markdown field', async () => {
      addPreviewItem(3);
      chrome.runtime.sendMessage.mockResolvedValue({
        success: true,
        data: { markdown: '# Markdown content' },
      });

      await runOCR(3, 'test3.png', 'data:image/png;base64,ghi');

      const results = stateMock.setOcrResults.mock.calls[0][0];
      expect(results[0].text).toBe('# Markdown content');
    });

    it('handles successful OCR with text field', async () => {
      addPreviewItem(4);
      chrome.runtime.sendMessage.mockResolvedValue({
        success: true,
        data: { text: 'plain text content' },
      });

      await runOCR(4, 'test4.png', 'data:image/png;base64,jkl');

      const results = stateMock.setOcrResults.mock.calls[0][0];
      expect(results[0].text).toBe('plain text content');
    });

    it('handles OCR failure response', async () => {
      const item = addPreviewItem(5);
      chrome.runtime.sendMessage.mockResolvedValue({
        success: false,
        error: 'Custom OCR error',
      });

      await runOCR(5, 'test5.png', 'data:image/png;base64,mno');

      expect(stateMock.setOcrResults).not.toHaveBeenCalled();
      expect(item.classList.contains('error')).toBe(true);
    });

    it('handles OCR failure with errorKey', async () => {
      const item = addPreviewItem(6);
      chrome.runtime.sendMessage.mockResolvedValue({
        success: false,
        errorKey: 'error.ocrFailed',
      });

      await runOCR(6, 'test6.png', 'data:image/png;base64,pqr');

      expect(item.classList.contains('error')).toBe(true);
    });

    it('handles OCR exception', async () => {
      const item = addPreviewItem(7);
      chrome.runtime.sendMessage.mockRejectedValue(new Error('Network failure'));

      await runOCR(7, 'test7.png', 'data:image/png;base64,stu');

      expect(item.classList.contains('error')).toBe(true);
      expect(item.title).toBe('Network failure');
    });

    it('decrements ocrRunning in finally block', async () => {
      addPreviewItem(8);
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, data: { text: 'ok' } });

      await runOCR(8, 'test8.png', 'data:image/png;base64,vwx');

      const calls = stateMock.setOcrRunning.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[calls.length - 1][0]).toBeLessThan(calls[0][0]);
    });

    it('decrements ocrRunning even on failure', async () => {
      addPreviewItem(9);
      chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'fail' });

      await runOCR(9, 'test9.png', 'data:image/png;base64,yz');

      const calls = stateMock.setOcrRunning.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('handles null data in response', async () => {
      addPreviewItem(10);
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, data: null });

      await runOCR(10, 'test10.png', 'data:image/png;base64,aa');

      const results = stateMock.setOcrResults.mock.calls[0][0];
      expect(results[0].text).toBe('');
    });
  });

  describe('ingestImages — vision toggle', () => {
    it('does NOT run OCR when visionEnabled is true', async () => {
      getSync.mockResolvedValue({ visionEnabled: true });
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      const file = new File(['dummy'], 'test.png', { type: 'image/png' });
      await ingestImages([file]);

      expect(bar.classList.contains('hidden')).toBe(false);
      expect(bar.querySelectorAll('.image-preview-item').length).toBe(1);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('runs OCR when visionEnabled is false', async () => {
      getSync.mockResolvedValue({ visionEnabled: false });
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, data: { text: 'ok' } });
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      const file = new File(['dummy'], 'test.png', { type: 'image/png' });
      await ingestImages([file]);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'ocrParse',
        file: expect.stringContaining('data:image/'),
      });
    });

    it('runs OCR when visionEnabled is absent (default off)', async () => {
      getSync.mockResolvedValue({});
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, data: { text: 'ok' } });
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      const file = new File(['dummy'], 'test.png', { type: 'image/png' });
      await ingestImages([file]);

      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    });
  });

  describe('addImageDataUri — direct injection', () => {
    it('adds a screenshot data URI to preview bar without OCR', async () => {
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      await addImageDataUri('data:image/png;base64,XXXX', '截图 2026-06-24 12:00');

      expect(bar.classList.contains('hidden')).toBe(false);
      expect(bar.querySelectorAll('.image-preview-item').length).toBe(1);
      const img = bar.querySelector('.image-thumb');
      expect(img.src).toBe('data:image/png;base64,XXXX');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });
});
