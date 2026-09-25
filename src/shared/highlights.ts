/**
 * F6 — persistent highlights & notes, plus the deep-annotation cache.
 * Shared types and pure helpers (content script, worker and panel).
 *
 * A highlight is anchored by a text-quote selector (W3C Web Annotation
 * style): the exact text plus a little context on each side, so it can be
 * found again after a reload even if the page's DOM is rebuilt.
 */

export interface TextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight extends TextQuoteSelector {
  id: string;
  /** normalizeUrl() of the page — the lookup key. */
  url: string;
  /** The page URL as visited. */
  pageUrl: string;
  title: string;
  note: string;
  createdAt: number;
}

/** Characters of context stored on each side of a highlight. */
export const QUOTE_CONTEXT_CHARS = 32;

/** FNV-1a 32-bit hash (hex) — cheap content fingerprint for cache keys. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Find the best occurrence of `sel.exact` in `text`: the one whose
 * surrounding text agrees most with the stored prefix/suffix. Returns the
 * start offset, or -1.
 */
export function locateQuote(text: string, sel: TextQuoteSelector): number {
  if (!sel.exact) return -1;
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(sel.exact); i !== -1; i = text.indexOf(sel.exact, i + 1)) {
    const before = text.slice(Math.max(0, i - sel.prefix.length), i);
    const after = text.slice(i + sel.exact.length, i + sel.exact.length + sel.suffix.length);
    let score = 0;
    for (let k = 1; k <= before.length && before[before.length - k] === sel.prefix[sel.prefix.length - k]; k++) score++;
    for (let k = 0; k < after.length && after[k] === sel.suffix[k]; k++) score++;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

/** Markdown export of highlights, grouped by page. */
export function highlightsToMarkdown(items: Highlight[], heading: string): string {
  const byPage = new Map<string, Highlight[]>();
  for (const h of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!byPage.has(h.url)) byPage.set(h.url, []);
    byPage.get(h.url)!.push(h);
  }
  let md = `# ${heading}\n`;
  for (const list of byPage.values()) {
    md += `\n## [${list[0].title || list[0].pageUrl}](${list[0].pageUrl})\n\n`;
    for (const h of list) {
      md += `> ${h.exact.replace(/\n/g, '\n> ')}\n`;
      if (h.note) md += `\n${h.note}\n`;
      md += '\n';
    }
  }
  return md;
}

/** Cached deep-annotation results for one page version. */
export interface AnnotationCacheEntry {
  /** normalizeUrl(page) + '|' + hashText(article). */
  key: string;
  results: { chunkIndex: number; annotations: import('./types').Annotation[] }[];
  createdAt: number;
}
