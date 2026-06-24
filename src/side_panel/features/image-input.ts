import { t } from '../../shared/i18n.js';
import { ingestImages } from '../services/ocr.js';

export function initImageInput({ userInput }: { userInput: HTMLElement }): void {
  document.body.dataset.dropHint = t('sidebar.dropHint');

  userInput.addEventListener('paste', handlePaste);

  function handlePaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = extractImageFilesFromItems(items);
    if (imageFiles.length > 0) {
      e.preventDefault();
      void ingestImages(imageFiles);
    }
  }

  document.body.addEventListener('dragover', handleDragOver);
  document.body.addEventListener('dragleave', handleDragLeave);
  document.body.addEventListener('drop', (e) => handleDrop(e));

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (hasImageFiles(e.dataTransfer)) document.body.classList.add('drag-over');
  }

  function handleDragLeave(e: DragEvent): void {
    if (!e.relatedTarget || !document.body.contains(e.relatedTarget as Node)) {
      document.body.classList.remove('drag-over');
    }
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const imageFiles = extractImageFilesFromFileList(e.dataTransfer!.files);
    if (imageFiles.length > 0) void ingestImages(imageFiles);
  }
}

function extractImageFilesFromItems(items: DataTransferItemList): File[] {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

function extractImageFilesFromFileList(fileList: FileList): File[] {
  const files: File[] = [];
  for (const file of fileList) {
    if (file.type.startsWith('image/')) files.push(file);
  }
  return files;
}

function hasImageFiles(dataTransfer: DataTransfer | null): boolean {
  return !!dataTransfer?.types.includes('Files');
}
