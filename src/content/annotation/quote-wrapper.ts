/**
 * Quote wrapping — locate a model-quoted sentence inside the DOM text-node
 * tree and wrap it in a <mark> so the annotation icon can anchor to it.
 * Pure DOM manipulation; no state, no network.
 *
 * Extracted from the former god module content/annotation.ts.
 */

/** CSS class applied to highlighted quote spans. */
export const MARK_CLASS = 'anno-mark';

/**
 * Locate `quote` inside the text-node tree of `root` and wrap the first
 * occurrence in <mark class="anno-mark">. Handles quotes that span multiple
 * adjacent text nodes. Leading/trailing whitespace on the quote is ignored.
 *
 * Returns the first created <mark> element on success, or null when the quote
 * is absent/empty (root left unmodified). The mark is what callers anchor the
 * annotation icon to, so the icon sits right next to the highlighted phrase.
 */
export function findAndWrap(root: HTMLElement, quote: string): HTMLElement | null {
  const q = quote.trim();
  if (!q) return null;

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
  if (entries.length === 0) return null;

  const full = entries.map((e) => e.node.nodeValue!).join('');
  const at = full.indexOf(q);
  if (at === -1) return null;
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
    return mark;
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

/** Fallback wrapper for quotes crossing element boundaries. Returns the first
 *  created mark (used as the icon anchor), or null if nothing was wrapped. */
function manualWrap(
  entries: { node: Text; start: number; length: number }[],
  at: number,
  end: number,
): HTMLElement | null {
  let firstMark: HTMLElement | null = null;
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
    if (!firstMark) firstMark = mark;
  }
  return firstMark;
}
