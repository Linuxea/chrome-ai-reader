// ocr.js — 图片上传 + OCR 文字识别

const imageUploadBtn = document.getElementById('imageUploadBtn');
const imageFileInput = document.getElementById('imageFileInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');

let ocrResults = [];
let ocrRunning = 0;
let imageIndex = 0;

imageUploadBtn.addEventListener('click', () => {
  imageFileInput.click();
});

imageFileInput.addEventListener('change', () => {
  const files = Array.from(imageFileInput.files);
  if (files.length === 0) return;
  imageFileInput.value = '';

  imagePreviewBar.classList.remove('hidden');

  files.forEach(file => {
    imageIndex++;
    const idx = imageIndex;
    const reader = new FileReader();

    reader.onload = (e) => {
      const dataUri = e.target.result;
      addImagePreview(idx, file.name, dataUri);
      runOCR(idx, file.name, dataUri);
    };

    reader.readAsDataURL(file);
  });
});

function addImagePreview(index, fileName, dataUri) {
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
    ocrResults = ocrResults.filter(r => r.index !== index);
    if (imagePreviewBar.children.length === 0) {
      imagePreviewBar.classList.add('hidden');
    }
  });

  imagePreviewBar.appendChild(item);
}

async function runOCR(index, fileName, dataUri) {
  ocrRunning++;
  const item = imagePreviewBar.querySelector(`[data-index="${index}"]`);
  const statusEl = item?.querySelector('.image-status');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'ocrParse',
      file: dataUri
    });

    if (response && response.success) {
      const text = extractOcrText(response.data);
      ocrResults.push({ index, fileName, text });
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
    ocrRunning--;
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

function collectImageDataUris() {
  const items = imagePreviewBar.querySelectorAll('.image-preview-item:not(.error)');
  const uris = [];
  items.forEach(item => {
    const img = item.querySelector('.image-thumb');
    if (img && img.src) uris.push({ index: parseInt(item.dataset.index), uri: img.src });
  });
  uris.sort((a, b) => a.index - b.index);
  return uris.map(u => u.uri);
}

function clearImagePreviews() {
  ocrResults = [];
  ocrRunning = 0;
  imageIndex = 0;
  imagePreviewBar.innerHTML = '';
  imagePreviewBar.classList.add('hidden');
}

function buildOcrContext() {
  if (ocrResults.length === 0) return '';
  const sorted = [...ocrResults].sort((a, b) => a.index - b.index);
  return sorted.map((r, i) => {
    return t('ai.ocrContext', { n: i + 1 }) + r.text;
  }).join('\n\n');
}

function hasImageErrors() {
  return imagePreviewBar.querySelectorAll('.image-preview-item.error').length > 0;
}
