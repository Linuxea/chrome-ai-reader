import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../src/side_panel/services/ocr.js', () => ({
  addImagePreview: vi.fn(),
  runOCR: vi.fn(),
}));

vi.mock('../../src/side_panel/state.js', () => ({
  getImageIndex: vi.fn(() => 0),
  setImageIndex: vi.fn(),
}));

vi.hoisted(() => {
  class MockFileReader {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.result = 'data:image/png;base64,mockdata';
    }
    readAsDataURL() {
      setTimeout(() => {
        if (this.onload) this.onload({ target: { result: this.result } });
      }, 0);
    }
  }
  globalThis.FileReader = MockFileReader;
});

import { initImageInput } from '../../src/side_panel/features/image-input.js';
import * as stateMock from '../../src/side_panel/state.js';
import * as ocrMock from '../../src/side_panel/services/ocr.js';

describe('initImageInput', () => {
  let userInput, imagePreviewBar;

  beforeEach(() => {
    vi.clearAllMocks();
    stateMock.getImageIndex.mockReturnValue(0);
    document.body.innerHTML = '';
    document.body.classList.remove('drag-over');
    delete document.body.dataset.dropHint;
    userInput = document.createElement('textarea');
    imagePreviewBar = document.createElement('div');
    imagePreviewBar.classList.add('hidden');
    document.body.appendChild(userInput);
    document.body.appendChild(imagePreviewBar);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sets dropHint on document body', () => {
    initImageInput({ userInput, imagePreviewBar });
    expect(document.body.dataset.dropHint).toBe('[sidebar.dropHint]');
  });

  it('registers paste event listener on userInput', () => {
    const spy = vi.spyOn(userInput, 'addEventListener');
    initImageInput({ userInput, imagePreviewBar });
    expect(spy).toHaveBeenCalledWith('paste', expect.any(Function));
  });

  it('registers dragover, dragleave, and drop on document.body', () => {
    const spy = vi.spyOn(document.body, 'addEventListener');
    initImageInput({ userInput, imagePreviewBar });
    expect(spy).toHaveBeenCalledWith('dragover', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('dragleave', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('drop', expect.any(Function));
  });

  describe('paste handling', () => {
    beforeEach(() => {
      initImageInput({ userInput, imagePreviewBar });
    });

    it('ignores paste without clipboardData items', () => {
      const event = new Event('paste', { bubbles: true });
      event.clipboardData = null;
      userInput.dispatchEvent(event);
      expect(stateMock.setImageIndex).not.toHaveBeenCalled();
    });

    it('ignores paste with non-image items', () => {
      const event = new Event('paste', { bubbles: true });
      event.clipboardData = {
        items: [{ kind: 'string', type: 'text/plain' }],
      };
      userInput.dispatchEvent(event);
      expect(stateMock.setImageIndex).not.toHaveBeenCalled();
    });

    it('processes image files from paste', () => {
      const mockFile = new File([''], 'paste.png', { type: 'image/png' });
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => mockFile }],
      };

      userInput.dispatchEvent(event);
      expect(stateMock.setImageIndex).toHaveBeenCalled();
      expect(imagePreviewBar.classList.contains('hidden')).toBe(false);
    });

    it('increments image index for each pasted file', () => {
      stateMock.getImageIndex.mockReturnValue(5);
      const mockFile = new File([''], 'img.png', { type: 'image/png' });
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => mockFile }],
      };

      userInput.dispatchEvent(event);
      expect(stateMock.setImageIndex).toHaveBeenCalledWith(6);
    });

    it('skips items where getAsFile returns null', () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }],
      };

      userInput.dispatchEvent(event);
      expect(stateMock.setImageIndex).not.toHaveBeenCalled();
    });
  });

  describe('drag and drop handling', () => {
    beforeEach(() => {
      initImageInput({ userInput, imagePreviewBar });
    });

    it('adds drag-over class on dragover with Files type', () => {
      const event = new Event('dragover', { bubbles: true, cancelable: true });
      event.dataTransfer = { types: ['Files'] };
      document.body.dispatchEvent(event);
      expect(document.body.classList.contains('drag-over')).toBe(true);
    });

    it('does not add drag-over class when no Files type', () => {
      const event = new Event('dragover', { bubbles: true, cancelable: true });
      event.dataTransfer = { types: ['text/plain'] };
      document.body.dispatchEvent(event);
      expect(document.body.classList.contains('drag-over')).toBe(false);
    });

    it('removes drag-over class on dragleave', () => {
      document.body.classList.add('drag-over');
      const event = new Event('dragleave', { bubbles: true, cancelable: true });
      event.relatedTarget = null;
      document.body.dispatchEvent(event);
      expect(document.body.classList.contains('drag-over')).toBe(false);
    });

    it('does not remove drag-over when relatedTarget is inside body', () => {
      document.body.classList.add('drag-over');
      const child = document.createElement('div');
      document.body.appendChild(child);
      const event = new Event('dragleave', { bubbles: true, cancelable: true });
      event.relatedTarget = child;
      document.body.dispatchEvent(event);
      expect(document.body.classList.contains('drag-over')).toBe(true);
    });

    it('removes drag-over and processes image files on drop', () => {
      document.body.classList.add('drag-over');
      const mockFile = new File([''], 'drop.png', { type: 'image/png' });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [mockFile] };

      document.body.dispatchEvent(event);
      expect(document.body.classList.contains('drag-over')).toBe(false);
      expect(stateMock.setImageIndex).toHaveBeenCalled();
      expect(imagePreviewBar.classList.contains('hidden')).toBe(false);
    });

    it('ignores drop of non-image files', () => {
      const mockFile = new File(['text'], 'doc.txt', { type: 'text/plain' });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [mockFile] };

      document.body.dispatchEvent(event);
      expect(stateMock.setImageIndex).not.toHaveBeenCalled();
    });

    it('handles empty file list on drop', () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [] };

      document.body.dispatchEvent(event);
      expect(stateMock.setImageIndex).not.toHaveBeenCalled();
    });
  });

  describe('FileReader integration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      initImageInput({ userInput, imagePreviewBar });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls addImagePreview and runOCR after FileReader loads', () => {
      stateMock.getImageIndex.mockReturnValue(1);
      const mockFile = new File([''], 'test.png', { type: 'image/png' });
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => mockFile }],
      };

      userInput.dispatchEvent(event);
      vi.advanceTimersByTime(10);

      expect(ocrMock.addImagePreview).toHaveBeenCalledWith(2, 'test.png', 'data:image/png;base64,mockdata');
      expect(ocrMock.runOCR).toHaveBeenCalledWith(2, 'test.png', 'data:image/png;base64,mockdata');
    });
  });
});
