/**
 * File → data-URI intake (the FileReader half of legacy services/images.ts).
 * Only image/* files pass; each batch is delivered once, in order.
 */
export function readImageFiles(files: FileList | File[], onBatch: (uris: string[]) => void): void {
  const images = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (images.length === 0) return;
  const uris: string[] = [];
  let pending = images.length;
  for (const file of images) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') uris.push(reader.result);
      if (--pending === 0) onBatch(uris);
    };
    reader.onerror = () => {
      if (--pending === 0) onBatch(uris);
    };
    reader.readAsDataURL(file);
  }
}

/** Clipboard / drag-drop image extraction — same acceptance rule as upload. */
export function imagesFromTransfer(dt: DataTransfer): File[] {
  return Array.from(dt.files).filter(f => f.type.startsWith('image/'));
}

