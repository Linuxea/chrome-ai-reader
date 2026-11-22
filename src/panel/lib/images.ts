/**
 * File → data-URI intake (the FileReader half of legacy services/images.ts).
 * Only image/* files pass; results are placed by INDEX so the batch order
 * always matches the user's selection order, no matter which reader
 * finishes first.
 */
export function readImageFiles(files: FileList | File[], onBatch: (uris: string[]) => void): void {
  const images = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (images.length === 0) return;
  const uris: string[] = new Array(images.length).fill('');
  let pending = images.length;
  for (let i = 0; i < images.length; i++) {
    const reader = new FileReader();
    const slot = i;
    reader.onload = () => {
      if (typeof reader.result === 'string') uris[slot] = reader.result;
      if (--pending === 0) onBatch(uris);
    };
    reader.onerror = () => {
      if (--pending === 0) onBatch(uris.filter(u => u !== ''));
    };
    reader.readAsDataURL(images[slot]!);
  }
}

/** Clipboard / drag-drop image extraction — same acceptance rule as upload. */
export function imagesFromTransfer(dt: DataTransfer): File[] {
  return Array.from(dt.files).filter(f => f.type.startsWith('image/'));
}

