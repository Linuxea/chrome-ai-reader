import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

// image-input now delegates the actual index/preview/OCR work to
// ingestImages (in services/ocr). The tests verify image-input's real
// responsibility: detecting paste/drop events, extracting image files,
// and forwarding them to ingestImages. They no longer assert on the
// internal state mutations that ingestImages owns.
vi.mock('../../src/side_panel/services/ocr.js', () => ({
  ingestImages: vi.fn(),
}));

import { initImageInput } from '../../src/side_panel/features/image-input.js';
import { ingestImages } from '../../src/side_panel/services/ocr.js';

describe('initImageInput', () => {
  let userInput;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    document.body.classList.remove('drag-over');
    delete document.body.dataset.dropHint;
    userInput = document.createElement('textarea');
    document.body.appendChild(userInput);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sets dropHint on document body', () => {
    initImageInput({ userInput });
    expect(document.body.dataset.dropHint).toBe('[sidebar.dropHint]');
  });

  it('registers paste event listener on userInput', () => {
    const spy = vi.spyOn(userInput, 'addEventListener');
    initImageInput({ userInput });
    expect(spy).toHaveBeenCalledWith('paste', expect.any(Function));
  });

  it('registers dragover, dragleave, and drop on document.body', () => {
    const spy = vi.spyOn(document.body, 'addEventListener');
    initImageInput({ userInput });
    expect(spy).toHaveBeenCalledWith('dragover', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('dragleave', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('drop', expect.any(Function));
  });

  describe('paste handling', () => {
    beforeEach(() => {
      initImageInput({ userInput });
    });

    it('ignores paste without clipboardData items', () => {
      const event = new Event('paste', { bubbles: true });
      event.clipboardData = null;
      userInput.dispatchEvent(event);
      expect(ingestImages).not.toHaveBeenCalled();
    });

    it('ignores paste with non-image items', () => {
      const event = new Event('paste', { bubbles: true });
      event.clipboardData = {
        items: [{ kind: 'string', type: 'text/plain' }],
      };
      userInput.dispatchEvent(event);
      expect(ingestImages).not.toHaveBeenCalled();
    });

    it('forwards image files from paste to ingestImages', () => {
      const mockFile = new File([''], 'paste.png', { type: 'image/png' });
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => mockFile }],
      };

      userInput.dispatchEvent(event);
      expect(ingestImages).toHaveBeenCalledWith([mockFile]);
    });

    it('prevents default when pasting images', () => {
      const mockFile = new File([''], 'paste.png', { type: 'image/png' });
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => mockFile }],
      };

      userInput.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it('skips items where getAsFile returns null', () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }],
      };

      userInput.dispatchEvent(event);
      expect(ingestImages).not.toHaveBeenCalled();
    });
  });

  describe('drag and drop handling', () => {
    beforeEach(() => {
      initImageInput({ userInput });
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

    it('removes drag-over and forwards image files on drop', () => {
      document.body.classList.add('drag-over');
      const mockFile = new File([''], 'drop.png', { type: 'image/png' });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [mockFile] };

      document.body.dispatchEvent(event);
      expect(document.body.classList.contains('drag-over')).toBe(false);
      expect(ingestImages).toHaveBeenCalledWith([mockFile]);
    });

    it('ignores drop of non-image files', () => {
      const mockFile = new File(['text'], 'doc.txt', { type: 'text/plain' });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [mockFile] };

      document.body.dispatchEvent(event);
      expect(ingestImages).not.toHaveBeenCalled();
    });

    it('handles empty file list on drop', () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [] };

      document.body.dispatchEvent(event);
      expect(ingestImages).not.toHaveBeenCalled();
    });
  });
});
