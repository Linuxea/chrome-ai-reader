/**
 * F3 — lazy pdf.js loader. pdf.js (~1 MB) and its worker are only fetched
 * the first time a PDF is read; Vite emits both as separate chunks. The
 * worker is an extension-origin module script, which MV3's CSP allows.
 */

import type * as PdfJs from 'pdfjs-dist';

let _pdfjs: Promise<typeof PdfJs> | null = null;

export function loadPdfjs(): Promise<typeof PdfJs> {
  _pdfjs ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  }).catch((e: unknown) => {
    _pdfjs = null; // allow a retry
    throw e;
  });
  return _pdfjs;
}
