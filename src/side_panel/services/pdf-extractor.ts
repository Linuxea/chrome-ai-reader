/**
 * F3 — read a PDF tab. Chrome's PDF viewer cannot host a content script, so
 * the panel fetches the file itself (host permission <all_urls> covers
 * cross-origin fetches; file:// needs "Allow access to file URLs") and pulls
 * the text out with pdf.js. Scanned PDFs have no text layer → an error, not
 * an empty article.
 */

import { t } from '../../shared/i18n.js';
import type { Result } from '../../shared/types';
import { ok, err } from '../../shared/result.js';
import { pageText, pdfParagraphs, type PdfTextItem } from '../../shared/pdf-text';
import { loadPdfjs } from './pdf-loader';

/** What a PDF yields (structurally an ExtractResult of page-extractor.ts). */
export interface PdfExtract {
  title: string;
  textContent: string;
  excerpt: string;
  paragraphs: string[];
}

export const MAX_PDF_PAGES = 500;
export const MAX_PDF_BYTES = 80 * 1024 * 1024;

function fileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.pdf$/i, '');
  } catch {
    return '';
  }
}

/** Does a URL without a .pdf path serve a PDF? (HEAD, best effort.) */
export async function servesPdf(url: string): Promise<boolean> {
  if (!/^https?:/.test(url)) return false;
  try {
    const res = await fetch(url, { method: 'HEAD', credentials: 'include' });
    return (res.headers.get('content-type') ?? '').toLowerCase().includes('application/pdf');
  } catch {
    return false;
  }
}

export async function extractPdf(url: string): Promise<Result<PdfExtract>> {
  let data: ArrayBuffer;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return err(new Error(t('error.pdfFetch', { status: res.status })));
    data = await res.arrayBuffer();
  } catch {
    return err(new Error(t(url.startsWith('file:') ? 'error.pdfFileAccess' : 'error.pdfFetch', { status: 0 })));
  }
  if (data.byteLength > MAX_PDF_BYTES) return err(new Error(t('error.pdfTooLarge')));

  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(data) });
    const doc = await task.promise;
    const pages: string[] = [];
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pageText(content.items.filter((it): it is PdfTextItem & typeof it => 'str' in it)));
      page.cleanup();
    }
    const meta = await doc.getMetadata().catch(() => null);
    void task.destroy();

    const paragraphs = pdfParagraphs(pages);
    if (!paragraphs.length) return err(new Error(t('error.pdfNoText')));
    const info = meta?.info as { Title?: string } | undefined;
    const textContent = paragraphs.join('\n\n');
    return ok({
      title: info?.Title?.trim() || fileName(url) || 'PDF',
      textContent,
      excerpt: textContent.slice(0, 200),
      paragraphs,
    });
  } catch (e: unknown) {
    return err(new Error(t('error.pdfParse', { message: (e as Error).message })));
  }
}
