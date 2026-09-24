import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../src/shared/constants.js', () => ({
  escapeHtml: (text) => text,
}));

vi.mock('../../src/side_panel/state.js', () => ({
  getImageIndex: vi.fn(() => 0),
  setImageIndex: vi.fn(),
}));

import * as stateMock from '../../src/side_panel/state.js';
import {
  initImages,
  ingestImages,
  addImageDataUri,
  addImagePreview,
  collectImageDataUris,
  clearImagePreviews,
} from '../../src/side_panel/services/images.js';

describe('images service', () => {
  let bar;

  beforeEach(() => {
    vi.clearAllMocks();
    let index = 0;
    stateMock.getImageIndex.mockImplementation(() => index);
    stateMock.setImageIndex.mockImplementation((v) => { index = v; });

    document.body.innerHTML = `
      <button id="imageUploadBtn"></button>
      <input id="imageFileInput" type="file" />
      <div id="imagePreviewBar" class="hidden"></div>
    `;
    initImages();
    bar = document.getElementById('imagePreviewBar');
  });

  describe('ingestImages', () => {
    it('adds a preview thumbnail per file and shows the bar', async () => {
      const files = [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.png', { type: 'image/png' }),
      ];
      await ingestImages(files);

      expect(bar.classList.contains('hidden')).toBe(false);
      const items = bar.querySelectorAll('.image-preview-item');
      expect(items).toHaveLength(2);
      expect(items[0].dataset.index).toBe('1');
      expect(items[1].dataset.index).toBe('2');
      expect(items[0].querySelector('.image-thumb').src).toContain('data:image/png');
    });

    it('shows no OCR status indicator (images go straight to the model)', async () => {
      await ingestImages([new File(['a'], 'a.png', { type: 'image/png' })]);
      expect(bar.querySelector('.image-status')).toBeNull();
    });

    it('does nothing for an empty list', async () => {
      await ingestImages([]);
      expect(bar.classList.contains('hidden')).toBe(true);
    });
  });

  describe('addImageDataUri', () => {
    it('adds a screenshot to the preview bar', () => {
      addImageDataUri('data:image/png;base64,XXXX', 'shot');

      expect(bar.classList.contains('hidden')).toBe(false);
      expect(bar.querySelector('.image-thumb').src).toBe('data:image/png;base64,XXXX');
    });
  });

  describe('remove button', () => {
    it('removes the item and hides the bar when it was the last one', () => {
      bar.classList.remove('hidden');
      addImagePreview(1, 'a.png', 'data:image/png;base64,A');
      bar.querySelector('.image-remove').click();

      expect(bar.children).toHaveLength(0);
      expect(bar.classList.contains('hidden')).toBe(true);
    });
  });

  describe('collectImageDataUris', () => {
    it('returns URIs ordered by index', () => {
      addImagePreview(2, 'b.png', 'data:image/png;base64,B');
      addImagePreview(1, 'a.png', 'data:image/png;base64,A');
      expect(collectImageDataUris()).toEqual(['data:image/png;base64,A', 'data:image/png;base64,B']);
    });
  });

  describe('clearImagePreviews', () => {
    it('empties and hides the bar and resets the index', () => {
      addImagePreview(1, 'a.png', 'data:image/png;base64,A');
      bar.classList.remove('hidden');
      clearImagePreviews();

      expect(bar.children).toHaveLength(0);
      expect(bar.classList.contains('hidden')).toBe(true);
      expect(stateMock.setImageIndex).toHaveBeenLastCalledWith(0);
    });
  });
});
