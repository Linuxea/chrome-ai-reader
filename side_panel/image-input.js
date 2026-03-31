// image-input.js — 图片粘贴与拖放处理

(function() {
  'use strict';

  // === DOM 引用 ===
  const userInput = document.getElementById('userInput');
  const imagePreviewBar = document.getElementById('imagePreviewBar');

  // === 初始化提示文字 ===
  document.body.dataset.dropHint = t('sidebar.dropHint');

  // === 粘贴事件 ===
  userInput.addEventListener('paste', handlePaste);

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles = extractImageFilesFromItems(items);
    if (imageFiles.length > 0) {
      e.preventDefault();
      processImages(imageFiles);
    }
  }

  // === 拖放事件 ===
  document.body.addEventListener('dragover', handleDragOver);
  document.body.addEventListener('dragleave', handleDragLeave);
  document.body.addEventListener('drop', handleDrop);

  function handleDragOver(e) {
    e.preventDefault();
    if (hasImageFiles(e.dataTransfer)) {
      document.body.classList.add('drag-over');
    }
  }

  function handleDragLeave(e) {
    // 只有当离开整个文档时才移除高亮
    if (!e.relatedTarget || !document.body.contains(e.relatedTarget)) {
      document.body.classList.remove('drag-over');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    document.body.classList.remove('drag-over');

    const imageFiles = extractImageFilesFromFileList(e.dataTransfer.files);
    if (imageFiles.length > 0) {
      processImages(imageFiles);
    }
  }

  // === 辅助函数 ===

  function extractImageFilesFromItems(items) {
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  }

  function extractImageFilesFromFileList(fileList) {
    const files = [];
    for (const file of fileList) {
      if (file.type.startsWith('image/')) {
        files.push(file);
      }
    }
    return files;
  }

  function hasImageFiles(dataTransfer) {
    if (dataTransfer.types.includes('Files')) {
      // 无法在 dragover 时检查具体文件类型，假设可能有图片
      return true;
    }
    return false;
  }

  function processImages(files) {
    if (files.length === 0) return;

    imagePreviewBar.classList.remove('hidden');

    files.forEach(file => {
      // 复用 side_panel.js 中的全局变量和函数
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
  }
})();
