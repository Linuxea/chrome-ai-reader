// services/ocr.js — 图片上传 + OCR 文字识别

import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';

let _imageUploadBtn;
let _imageFileInput;
let _imagePreviewBar;

export function initOCR() {
  _imageUploadBtn = document.getElementById('imageUploadBtn');
  _imageFileInput = document.getElementById('imageFileInput');
  _imagePreviewBar = document.getElementById('imagePreviewBar');

  _imageUploadBtn.addEventListener('click', () => {
    _imageFileInput.click();
  });

  _imageFileInput.addEventListener('change', () => {
    const files = Array.from(_imageFileInput.files);
    if (files.length === 0) return;
    _imageFileInput.value = '';

    _imagePreviewBar.classList.remove('hidden');

    files.forEach(file => {
      let idx = state.getImageIndex();
      idx++;
      state.setImageIndex(idx);
      const reader = new FileReader();

      reader.onload = (e) => {
        const dataUri = e.target.result;
        addImagePreview(idx, file.name, dataUri);
        runOCR(idx, file.name, dataUri);
      };

      reader.readAsDataURL(file);
    });
  });
}

export function addImagePreview(index, fileName, dataUri) {
  const item = document.createElement('div');
  item.className = 'image-preview-item';
  item.dataset.index = index;

  item.innerHTML = `
    <img src="${dataUri}" class="image-thumb" alt="${escapeHtml(fileName)}">
    <span class="image-status loading"></span>
    <button class="image-remove" title="${t('sidebar.remove')}">×</button>
  `;

  item.querySelector('.image-remove').addEventListener('click', () => {
    item.remove();
    const results = state.getOcrResults().filter(r => r.index !== index);
    state.setOcrResults(results);
    if (_imagePreviewBar.children.length === 0) {
      _imagePreviewBar.classList.add('hidden');
    }
  });

  _imagePreviewBar.appendChild(item);
}

export async function runOCR(index, fileName, dataUri) {
  let ocrRunning = state.getOcrRunning();
  ocrRunning++;
  state.setOcrRunning(ocrRunning);
  const item = _imagePreviewBar.querySelector(`[data-index="${index}"]`);
  const statusEl = item?.querySelector('.image-status');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'ocrParse',
      file: dataUri
    });

    if (response && response.success) {
      const text = extractOcrText(response.data);
      const results = state.getOcrResults();
      results.push({ index, fileName, text });
      state.setOcrResults(results);
      if (statusEl) statusEl.className = 'image-status done';
      if (item) item.classList.add('done');
    } else {
      if (statusEl) statusEl.className = 'image-status error';
      if (item) item.classList.add('error');
    }
  } catch (e) {
    if (statusEl) statusEl.className = 'image-status error';
    if (item) item.classList.add('error');
  } finally {
    let running = state.getOcrRunning();
    running--;
    state.setOcrRunning(running);
  }
}

function extractOcrText(data) {
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

export function collectImageDataUris() {
  const items = _imagePreviewBar.querySelectorAll('.image-preview-item:not(.error)');
  const uris = [];
  items.forEach(item => {
    const img = item.querySelector('.image-thumb');
    if (img && img.src) uris.push({ index: parseInt(item.dataset.index), uri: img.src });
  });
  uris.sort((a, b) => a.index - b.index);
  return uris.map(u => u.uri);
}

export function clearImagePreviews() {
  state.setOcrResults([]);
  state.setOcrRunning(0);
  state.setImageIndex(0);
  _imagePreviewBar.innerHTML = '';
  _imagePreviewBar.classList.add('hidden');
}

export function buildOcrContext() {
  const ocrResults = state.getOcrResults();
  if (ocrResults.length === 0) return '';
  const sorted = [...ocrResults].sort((a, b) => a.index - b.index);
  return sorted.map((r, i) => {
    return t('ai.ocrContext', { n: i + 1 }) + r.text;
  }).join('\n\n');
}

export function hasImageErrors() {
  return _imagePreviewBar.querySelectorAll('.image-preview-item.error').length > 0;
}

export function getOcrRunning() {
  return state.getOcrRunning();
}
