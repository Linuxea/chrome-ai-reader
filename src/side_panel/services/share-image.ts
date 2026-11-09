/**
 * F14 — share-image service: turns a share card DOM node into a PNG.
 *
 * Pipeline (design §4.1): build card → mount off-screen to measure →
 * XMLSerializer → <svg><foreignObject> blob → Image → canvas.drawImage at
 * 2x → PNG Blob → download / clipboard.
 *
 * Deliberately thin: jsdom cannot run Image/canvas, so this module stays
 * free of decision logic (truncation cascade and card structure live in
 * ui/share-card; collection + modal in features/share-image). The
 * rasterization itself is manual-verified (AC-02 / AC-03).
 */

import { fitShareCard, type ShareCardData, type FittedShareCard } from '../ui/share-card';
import { downloadFile, sanitizeFilename } from '../../shared/download';
import { formatDateOnly } from '../../shared/format';
import { t } from '../../shared/i18n.js';

/** D-01: 720 CSS px card → 1440 px wide PNG (crisp in chat apps). */
const PNG_SCALE = 2;

/** Mount off-screen, read the laid-out height, remove immediately. */
function measureOffscreen(el: HTMLElement): number {
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  el.style.top = '0';
  document.body.appendChild(el);
  const height = Math.ceil(el.getBoundingClientRect().height);
  el.remove();
  return height;
}

/** Build the card with the E-01 fit cascade (soft cut → 560px → hard cut). */
export function buildFittedCard(data: ShareCardData): FittedShareCard {
  return fitShareCard(data, measureOffscreen);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // E-02: rasterization failure propagates — the caller toasts and never
    // opens the modal.
    img.onerror = () => reject(new Error('share card rasterization failed'));
    img.src = url;
  });
}

/**
 * Serialize `el` into a self-contained SVG (foreignObject), load it as an
 * image and paint it onto a canvas at `scale`. The card carries its own
 * inline <style> and no external url() references, so the canvas is not
 * tainted and toBlob works.
 */
export async function rasterizeElement(
  el: HTMLElement,
  width: number,
  height: number,
  scale: number = PNG_SCALE,
): Promise<Blob> {
  const html = new XMLSerializer().serializeToString(el);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${html}</foreignObject></svg>`;
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob produced nothing'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** AC-02: `小梨子_YYYY-MM-DD_页面标题前30字.png` (title part omitted when empty). */
export function buildShareFilename(pageTitle: string): string {
  const parts = [sanitizeFilename(t('share.filePrefix')), formatDateOnly(new Date())];
  if (pageTitle && pageTitle.trim()) parts.push(sanitizeFilename(pageTitle));
  return `${parts.join('_')}.png`;
}

/** R-05: save the PNG via the shared download path. */
export function downloadShareImage(blob: Blob, filename: string): void {
  downloadFile(blob, filename, 'image/png');
}

/** R-05 / E-03: write the PNG to the clipboard (manifest: clipboardWrite). */
export async function copyShareImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
