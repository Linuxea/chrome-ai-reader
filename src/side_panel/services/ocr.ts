import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import { CSS } from '../../shared/css-selectors';
import { getSync } from '../../platform/storage';
import * as state from '../state';

let _imageUploadBtn: HTMLElement;
let _imageFileInput: HTMLInputElement;
let _imagePreviewBar: HTMLElement;
let _ocrGeneration = 0;

export function initOCR(): void {
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
 * Shared image intake: assigns each file an incrementing index, reads it as a
 * data URI, then adds a preview thumbnail. When `visionEnabled` is true (the
 * model supports vision), OCR is skipped — the image will be sent to the model
 * as an `image_url` block instead. When false, OCR runs as before.
 *
 * Used by both the upload button (initOCR) and the paste/drag-drop handler
 * (features/image-input). Extracted to eliminate duplicated index+FileReader
 * loops that had drifted in parallel.
 */
export async function ingestImages(files: File[]): Promise<void> {
  if (files.length === 0) return;
  _imagePreviewBar.classList.remove('hidden');
  const { visionEnabled } = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
  const visionOn = visionEnabled === true;
  for (const file of files) {
    let idx = state.getImageIndex();
    idx++;
    state.setImageIndex(idx);
    const dataUri = await readAsDataURL(file);
    addImagePreview(idx, file.name, dataUri);
    if (!visionOn) runOCR(idx, file.name, dataUri);
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

/**
 * Add a screenshot (or any pre-decoded image data URI) directly to the preview
 * bar without triggering OCR. Used by the "视觉分析" capture button —
 * screenshots are meant for the vision model, never for OCR.
 */
export async function addImageDataUri(dataUri: string, name: string): Promise<void> {
  _imagePreviewBar.classList.remove('hidden');
  let idx = state.getImageIndex();
  idx++;
  state.setImageIndex(idx);
  addImagePreview(idx, name, dataUri);
}

export function addImagePreview(index: number, fileName: string, dataUri: string): void {
  const item = document.createElement('div');
  item.className = 'image-preview-item';
  item.dataset.index = String(index);

  item.innerHTML = `
    <img src="${dataUri}" class="image-thumb" alt="${escapeHtml(fileName)}">
    <span class="image-status loading"></span>
    <button class="image-remove" title="${t('sidebar.remove')}">×</button>
  `;

  item.querySelector('.image-remove')!.addEventListener('click', () => {
    item.remove();
    const results = state.getOcrResults().filter(r => r.index !== index);
    state.setOcrResults(results);
    if (_imagePreviewBar.children.length === 0) {
      _imagePreviewBar.classList.add('hidden');
    }
  });

  _imagePreviewBar.appendChild(item);
}

export async function runOCR(index: number, fileName: string, dataUri: string): Promise<void> {
  const generation = _ocrGeneration;
  let ocrRunning = state.getOcrRunning();
  ocrRunning++;
  state.setOcrRunning(ocrRunning);
  const item = _imagePreviewBar.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
  const statusEl = item?.querySelector(CSS.IMAGE_STATUS) as HTMLElement | null;

  function setError(msg: string): void {
    if (statusEl) statusEl.className = 'image-status error';
    if (item) {
      item.classList.add('error');
      item.title = msg;
    }
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'ocrParse',
      file: dataUri,
    }) as { success?: boolean; error?: string; errorKey?: string; data?: OcrData };

    if (response && response.success) {
      const text = extractOcrText(response.data);
      if (generation === _ocrGeneration) {
        const results = state.getOcrResults();
        results.push({ index, fileName, text });
        state.setOcrResults(results);
      }
      if (statusEl) statusEl.className = 'image-status done';
      if (item) item.classList.add('done');
    } else {
      const errorMsg = response?.errorKey ? t(response.errorKey) : (response?.error || t('error.ocrFailed'));
      setError(errorMsg);
    }
  } catch (e: unknown) {
    setError((e as Error).message || t('error.ocrFailed'));
  } finally {
    let running = state.getOcrRunning();
    running--;
    state.setOcrRunning(running);
  }
}

interface OcrData {
  md_results?: string;
  content_list?: { text?: string }[];
  markdown?: string;
  text?: string;
}

function extractOcrText(data: OcrData | undefined | null): string {
  if (!data) return '';
  if (data.md_results) return data.md_results;
  if (data.content_list && Array.isArray(data.content_list)) {
    return data.content_list
      .map(item => item.text || '')
      .filter(t => t.trim())
      .join('\n');
  }
  if (data.markdown) return data.markdown;
  if (data.text) return data.text;
  return '';
}

export function collectImageDataUris(): string[] {
  const items = _imagePreviewBar.querySelectorAll(`${CSS.IMAGE_PREVIEW_ITEM}:not(.error)`);
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
  _ocrGeneration++;
  state.setOcrResults([]);
  state.setImageIndex(0);
  _imagePreviewBar.innerHTML = '';
  _imagePreviewBar.classList.add('hidden');
}

export function buildOcrContext(): string {
  const ocrResults = state.getOcrResults();
  if (ocrResults.length === 0) return '';
  const sorted = [...ocrResults].sort((a, b) => a.index - b.index);
  return sorted.map((r, i) => {
    return t('ai.ocrContext', { n: i + 1 }) + r.text;
  }).join('\n\n');
}

export function hasImageErrors(): boolean {
  return _imagePreviewBar.querySelectorAll(CSS.IMAGE_PREVIEW_ERROR).length > 0;
}

export function getOcrRunning(): number {
  return state.getOcrRunning();
}

/**
 * Validate that OCR state allows sending a message.
 * Returns null if OK, or an error message string if validation fails.
 */
export function validateImageState(): string | null {
  if (state.getOcrRunning() > 0) return t('error.ocrRunning');
  if (hasImageErrors()) {
    const firstError = document.querySelector(CSS.IMAGE_PREVIEW_ERROR);
    const reason = firstError?.getAttribute('title') || '';
    return t('error.ocrPartialFail') + (reason ? `：${reason}` : '');
  }
  return null;
}
