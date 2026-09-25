/**
 * F3 — turning pdf.js text items into readable text. Pure; the loading
 * lives in side_panel/services/pdf-extractor.ts.
 */

/** The fields of a pdf.js TextItem this module reads. */
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

/** URL whose path names a PDF (`/paper.pdf`, `/x.PDF?dl=1`). */
export function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) && /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** One page's text: items joined, with a newline at each end-of-line. */
export function pageText(items: PdfTextItem[]): string {
  let out = '';
  for (const it of items) {
    out += it.str;
    if (it.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

/** A line that ends a paragraph: sentence punctuation at the end. */
const PARAGRAPH_END = /[.!?。！？:：;；"”)]$/;

/**
 * Paragraphs of a PDF: PDF text arrives as hard-wrapped lines, so consecutive
 * lines are joined (a trailing hyphen re-joins a split word) and a paragraph
 * ends at a blank line, or at a short line ending in sentence punctuation.
 */
export function pdfParagraphs(pages: string[], shortLine = 0.7): string[] {
  const out: string[] = [];
  for (const page of pages) {
    const lines = page.split('\n').map((l) => l.trim());
    const longest = Math.max(1, ...lines.map((l) => l.length));
    let cur = '';
    const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (const line of lines) {
      if (!line) { flush(); continue; }
      if (cur.endsWith('-') && /^[a-z]/.test(line)) cur = cur.slice(0, -1) + line;
      else cur = cur ? `${cur}${/[㐀-鿿]$/.test(cur) && /^[㐀-鿿]/.test(line) ? '' : ' '}${line}` : line;
      if (PARAGRAPH_END.test(line) && line.length < longest * shortLine) flush();
    }
    flush();
  }
  return out;
}
