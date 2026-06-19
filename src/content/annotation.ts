/**
 * Deep annotation content module — collects paragraph chunks from the page,
 * requests per-chunk annotations via the background 'annotation' port,
 * highlights model-quoted sentences, and renders click-to-open bubbles.
 *
 * Spec: docs/superpowers/specs/2026-06-20-deep-annotation-design.md
 */
import type { Annotation, AnnotationPerspective } from '../shared/types';
import { ICON_BY_PERSPECTIVE, LABEL_BY_PERSPECTIVE } from './annotation-meta';

/** Minimum paragraph length (trimmed) to be considered a content chunk. */
export const MIN_CHUNK_LENGTH = 40;

export interface CollectedChunk {
  node: HTMLParagraphElement;
  text: string;
}

/** Selectors for semantic content containers, in priority order. */
const CONTAINER_SELECTORS = ['article', 'main', '[role="main"]'];

/**
 * Collect content paragraphs from the page as ordered chunks.
 * Prefers article/main/[role=main] containers; falls back to body <p>.
 * Skips non-content elements (nav, footer, script, aside, etc.) and short paragraphs.
 */
export function collectChunks(root: Document | HTMLElement = document): CollectedChunk[] {
  const doc = root;
  let container: ParentNode | null = null;
  for (const sel of CONTAINER_SELECTORS) {
    const found = (doc as Document).querySelector?.(sel) ?? null;
    if (found) { container = found; break; }
  }
  if (!container) container = (doc as Document).body ?? null;
  if (!container) return [];

  const paragraphs = Array.from(container.querySelectorAll<HTMLParagraphElement>('p'));
  const chunks: CollectedChunk[] = [];
  for (const p of paragraphs) {
    // Skip paragraphs inside nav/footer/script/aside
    if (p.closest('nav, footer, aside, script, style')) continue;
    const text = (p.innerText || p.textContent || '').trim();
    if (text.length < MIN_CHUNK_LENGTH) continue;
    chunks.push({ node: p, text });
  }
  return chunks;
}

/** Build the full-article context string from collected chunks. */
export function buildFullArticle(chunks: CollectedChunk[]): string {
  return chunks.map((c, i) => `[第${i}段] ${c.text}`).join('\n\n');
}

/** CSS class applied to highlighted quote spans. */
export const MARK_CLASS = 'anno-mark';

/**
 * Locate `quote` inside the text-node tree of `root` and wrap the first
 * occurrence in <mark class="anno-mark">. Handles quotes that span multiple
 * adjacent text nodes. Leading/trailing whitespace on the quote is ignored.
 *
 * Returns true if the quote was found and wrapped; false otherwise (root left
 * unmodified).
 */
export function findAndWrap(root: HTMLElement, quote: string): boolean {
  const q = quote.trim();
  if (!q) return false;

  // Gather text nodes with their cumulative offset.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const entries: { node: Text; start: number; length: number }[] = [];
  let offset = 0;
  let current: Text | null;
  while ((current = walker.nextNode() as Text | null)) {
    if (current.nodeValue) {
      entries.push({ node: current, start: offset, length: current.nodeValue.length });
      offset += current.nodeValue.length;
    }
  }
  if (entries.length === 0) return false;

  const full = entries.map((e) => e.node.nodeValue!).join('');
  const at = full.indexOf(q);
  if (at === -1) return false;
  const end = at + q.length;

  // Build a range covering the quote and surround it. Range.surroundContents
  // requires the range to not partially select a non-text node — since our
  // range only touches text nodes, this is safe.
  const startNode = locateTextNode(entries, at);
  const endNode = locateTextNode(entries, end);
  const mark = document.createElement('mark');
  mark.className = MARK_CLASS;

  const range = document.createRange();
  range.setStart(startNode.textNode, startNode.localOffset);
  range.setEnd(endNode.textNode, endNode.localOffset);

  try {
    range.surroundContents(mark);
    return true;
  } catch {
    // surroundContents can throw if the quote crosses element boundaries.
    // Fall back to manual wrapping across the collected text nodes.
    return manualWrap(entries, at, end);
  }
}

function locateTextNode(
  entries: { node: Text; start: number; length: number }[],
  globalOffset: number,
): { textNode: Text; localOffset: number } {
  for (const e of entries) {
    if (globalOffset >= e.start && globalOffset <= e.start + e.length) {
      return { textNode: e.node, localOffset: globalOffset - e.start };
    }
  }
  const last = entries[entries.length - 1];
  return { textNode: last.node, localOffset: last.length };
}

/** Fallback wrapper for quotes crossing element boundaries. */
function manualWrap(
  entries: { node: Text; start: number; length: number }[],
  at: number,
  end: number,
): boolean {
  let wrapped = false;
  for (const e of entries) {
    const nodeEnd = e.start + e.length;
    if (nodeEnd <= at || e.start >= end) continue; // no overlap
    const localStart = Math.max(0, at - e.start);
    const localEnd = Math.min(e.length, end - e.start);
    if (localStart >= localEnd) continue;
    const mark = document.createElement('mark');
    mark.className = MARK_CLASS;
    const middle = e.node.splitText(localStart);
    middle.splitText(localEnd - localStart);
    middle.parentNode!.insertBefore(mark, middle);
    mark.appendChild(middle);
    wrapped = true;
  }
  return wrapped;
}
