/**
 * F6 — highlights in the page. Painted with the CSS Custom Highlight API
 * (`CSS.highlights` + `::highlight()`), which colours ranges without
 * touching the page's DOM — no wrapper elements that could break site
 * scripts or layout — and handles selections spanning several elements.
 *
 * Anchoring: a highlight stores a text-quote selector; on load the page's
 * text is flattened once and each quote is located with its context
 * (shared/highlights.ts locateQuote) and mapped back to a DOM Range.
 */

import { QUOTE_CONTEXT_CHARS, locateQuote, type Highlight, type TextQuoteSelector } from '../shared/highlights';

const HIGHLIGHT_NAME = 'ai-reader-highlight';
const STYLE_ID = 'ai-reader-highlight-style';

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

/** Flatten the visible text of `root` into one string with a node map. */
export function buildTextIndex(root: Node = document.body): TextIndex {
  const nodes: TextIndex['nodes'] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('script, style, noscript, textarea, .anno-bubble-host')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, start: text.length });
    text += node.nodeValue ?? '';
  }
  return { text, nodes };
}

/** DOM position of a character offset in the flattened text. */
function positionAt(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = index.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.nodes[mid].start <= offset) lo = mid; else hi = mid - 1;
  }
  const entry = index.nodes[lo];
  if (!entry) return null;
  return { node: entry.node, offset: Math.min(offset - entry.start, entry.node.length) };
}

/** Selector for the current selection, or null when nothing (or only whitespace) is selected. */
export function selectorFromSelection(selection: Selection | null = window.getSelection()): TextQuoteSelector | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const exact = range.toString();
  if (!exact.trim()) return null;
  const index = buildTextIndex();
  const startEntry = index.nodes.find((n) => n.node === range.startContainer);
  if (!startEntry) return { exact, prefix: '', suffix: '' };
  const start = startEntry.start + range.startOffset;
  return {
    exact,
    prefix: index.text.slice(Math.max(0, start - QUOTE_CONTEXT_CHARS), start),
    suffix: index.text.slice(start + exact.length, start + exact.length + QUOTE_CONTEXT_CHARS),
  };
}

/** Re-anchor a selector in the live page. */
export function rangeFromSelector(sel: TextQuoteSelector, index: TextIndex = buildTextIndex()): Range | null {
  const start = locateQuote(index.text, sel);
  if (start < 0) return null;
  const a = positionAt(index, start);
  const b = positionAt(index, start + sel.exact.length);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 213, 79, 0.55); }`;
  (document.head || document.documentElement).appendChild(style);
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = (): HighlightRegistry | null =>
  (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights ?? null;

/** Paint these highlights (replacing what was painted). Returns how many were found in the page. */
export function paintHighlights(items: Highlight[]): number {
  const reg = registry();
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !HighlightCtor) return 0; // browser without the Custom Highlight API
  const index = buildTextIndex();
  const ranges = items.map((h) => rangeFromSelector(h, index)).filter((r): r is Range => r !== null);
  if (!ranges.length) { reg.delete(HIGHLIGHT_NAME); return 0; }
  ensureStyle();
  reg.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
  return ranges.length;
}

function send<T>(msg: Record<string, unknown>): Promise<T | undefined> {
  try {
    return chrome.runtime.sendMessage(msg) as Promise<T>;
  } catch {
    return Promise.resolve(undefined); // extension context invalidated
  }
}

/** Load this page's stored highlights and paint them. */
export async function restoreHighlights(): Promise<number> {
  const res = await send<{ success?: boolean; highlights?: Highlight[] }>({ action: 'highlights:list', pageUrl: location.href });
  return res?.success ? paintHighlights(res.highlights ?? []) : 0;
}

/** Save the current selection as a highlight (with an optional note) and repaint. */
export async function highlightSelection(note = ''): Promise<Highlight | null> {
  const sel = selectorFromSelection();
  if (!sel) return null;
  const res = await send<{ success?: boolean; highlight?: Highlight }>({
    action: 'highlights:add', ...sel, note, pageUrl: location.href, title: document.title,
  });
  window.getSelection()?.removeAllRanges();
  await restoreHighlights();
  return res?.success ? res.highlight ?? null : null;
}
