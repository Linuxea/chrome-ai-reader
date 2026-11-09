/**
 * Trigger a browser file download by creating a temporary blob URL.
 */
export function downloadFile(content: string | ArrayBuffer | Blob, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Make a string safe to use as (part of) a filename: strip path separators and
 * characters Windows/macOS reserve, collapse newlines, cap at 30 chars.
 * Used by chat-history markdown export and F14 share-image filenames.
 */
export function sanitizeFilename(title: string): string {
  return title.replace(/[/\\:*?"<>|\n\r]/g, '_').slice(0, 30);
}
