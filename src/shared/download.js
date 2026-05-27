/**
 * Trigger a browser file download by creating a temporary blob URL.
 * @param {string|ArrayBuffer} content - File content to download
 * @param {string} filename - Suggested file name for the download
 * @param {string} mimeType - MIME type (e.g. 'text/markdown', 'audio/mpeg')
 * @returns {void}
 */
export function downloadFile(content, filename, mimeType) {
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
