/**
 * Image intake + preview bar.
 *
 * The chat model is assumed multimodal: pending images are always sent to it
 * as `image_url` parts (there is no OCR fallback and no vision toggle).
 */
import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import { CSS } from '../../shared/css-selectors';
import * as state from '../state';
import { updateSendButtonDim } from '../ui/dom-helpers';

let _imageUploadBtn: HTMLElement;
let _imageFileInput: HTMLInputElement;
let _imagePreviewBar: HTMLElement;

export function initImages(): void {
  _imageUploadBtn = document.getElementById('imageUploadBtn')!;
  _imageFileInput = document.getElementById('imageFileInput') as HTMLInputElement;
  _imagePreviewBar = document.getElementById('imagePreviewBar')!;

  _imageUploadBtn.addEventListener('click', () => {
    _imageFileInput.click();
  });

  _imageFileInput.addEventListener('change', () => {
    const files = Array.from(_imageFileInput.files || []);
    if (files.length === 0) return;
    _imageFileInput.value = '';
    void ingestImages(files);
  });
}

/**
 * Shared image intake for the upload button and paste / drag-drop
 * (features/image-input): assigns each file an incrementing index, reads it
 * as a data URI and adds a preview thumbnail.
 */
export async function ingestImages(files: File[]): Promise<void> {
  if (files.length === 0) return;
  _imagePreviewBar.classList.remove('hidden');
  for (const file of files) {
    const dataUri = await readAsDataURL(file);
    addImagePreview(nextImageIndex(), file.name, dataUri);
  }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function nextImageIndex(): number {
  const idx = state.getImageIndex() + 1;
  state.setImageIndex(idx);
  return idx;
}

/** Add a pre-decoded image data URI (a screenshot) to the preview bar. */
export function addImageDataUri(dataUri: string, name: string): void {
  _imagePreviewBar.classList.remove('hidden');
  addImagePreview(nextImageIndex(), name, dataUri);
}

export function addImagePreview(index: number, fileName: string, dataUri: string): void {
  const item = document.createElement('div');
  item.className = 'image-preview-item';
  item.dataset.index = String(index);

  item.innerHTML = `
    <img class="image-thumb" alt="${escapeHtml(fileName)}">
    <button class="image-remove" title="${t('sidebar.remove')}">×</button>
  `;
  // Set src via DOM API (not innerHTML) to avoid XSS via crafted URIs
  (item.querySelector('.image-thumb') as HTMLImageElement).src = dataUri;

  item.querySelector('.image-remove')!.addEventListener('click', () => {
    item.remove();
    if (_imagePreviewBar.children.length === 0) {
      _imagePreviewBar.classList.add('hidden');
    }
    updateSendButtonDim();
  });

  _imagePreviewBar.appendChild(item);
  updateSendButtonDim();
}

/** True when the preview bar holds images waiting to be sent. */
export function hasPendingImages(): boolean {
  return _imagePreviewBar?.querySelector(CSS.IMAGE_PREVIEW_ITEM) != null;
}

export function collectImageDataUris(): string[] {
  const items = _imagePreviewBar.querySelectorAll(CSS.IMAGE_PREVIEW_ITEM);
  const uris: { index: number; uri: string }[] = [];
  items.forEach(item => {
    const el = item as HTMLElement;
    const img = el.querySelector(CSS.IMAGE_THUMB) as HTMLImageElement | null;
    if (img && img.src) uris.push({ index: parseInt(el.dataset.index!), uri: img.src });
  });
  uris.sort((a, b) => a.index - b.index);
  return uris.map(u => u.uri);
}

export function clearImagePreviews(): void {
  state.setImageIndex(0);
  _imagePreviewBar.innerHTML = '';
  _imagePreviewBar.classList.add('hidden');
  updateSendButtonDim();
}
