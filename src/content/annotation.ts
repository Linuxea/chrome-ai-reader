/**
 * Deep annotation content module — collects paragraph chunks from the page,
 * requests per-chunk annotations via the background 'annotation' port,
 * highlights model-quoted sentences, and renders click-to-open bubbles.
 *
 * Spec: docs/superpowers/specs/2026-06-20-deep-annotation-design.md
 */
import type { Annotation } from '../shared/types';
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

// --- Bubble rendering (Shadow-DOM isolated) ---

/** Singleton container appended to document.body; holds bubbles + isolated CSS. */
let _bubbleHost: HTMLElement | null = null;

const BUBBLE_CSS = `
  .anno-bubble {
    position: absolute;
    width: 320px;
    background: #fff;
    color: #1f2329;
    border: 1px solid #e5e6eb;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.14);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
    pointer-events: auto;
    box-sizing: border-box;
  }
  .anno-bubble-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #f0f1f3; font-weight: 600; }
  .anno-bubble-label { flex: 1; }
  .anno-bubble-close { background: none; border: none; cursor: pointer; font-size: 14px; color: #86909c; padding: 0 2px; }
  .anno-comment { padding: 10px 12px; color: #1f2329; word-break: break-word; }
  .anno-followup { display: block; width: 100%; text-align: left; border: none; border-top: 1px solid #f0f1f3; background: #f7f8fa; color: #165dff; cursor: pointer; padding: 8px 12px; font: inherit; box-sizing: border-box; }
  .anno-followup:hover { background: #eef2ff; }
  .anno-bubble.critique .anno-bubble-header { background: #fff7e6; }
  .anno-bubble.counterpoint .anno-bubble-header { background: #e8f7ef; }
  .anno-bubble.flaw .anno-bubble-header { background: #fff1f0; }
`;

/**
 * Return (and lazily create) the bubble host element whose Shadow DOM holds the
 * open bubble. Pass `reset=true` to drop the singleton (tests).
 */
export function getBubbleHost(reset = false): HTMLElement {
  if (reset) {
    _bubbleHost?.remove();
    _bubbleHost = null;
  }
  if (_bubbleHost) return _bubbleHost;

  const host = document.createElement('div');
  host.id = 'anno-bubble-host';
  // Zero-size absolute container anchored at the document origin. Bubbles use
  // position:absolute with DOCUMENT coordinates (getBoundingClientRect +
  // scroll offset), so they scroll naturally with the page — no scroll
  // listener needed. pointer-events:none on the host lets clicks pass through;
  // each .anno-bubble re-enables pointer-events:auto (see BUBBLE_CSS).
  host.style.position = 'absolute';
  host.style.zIndex = '2147483647';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.pointerEvents = 'none';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${BUBBLE_CSS}</style><div class="anno-bubble-layer" part="layer"></div>`;
  document.body.appendChild(host);
  _bubbleHost = host;
  return host;
}

/** Handle returned when attaching an icon to a node. */
export interface IconHandle {
  button: HTMLButtonElement;
}

/**
 * Attach an annotation icon next to `node`. On click, opens a Shadow-DOM bubble
 * showing the comment; only one bubble open at a time. `onFollowUp` (optional)
 * is invoked with the comment text when the user clicks "follow up in chat".
 */
export function createIconFor(
  node: HTMLElement,
  annotation: Annotation,
  onFollowUp?: (comment: string) => void,
): IconHandle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `anno-icon anno-icon-${annotation.perspective}`;
  button.setAttribute('aria-label', LABEL_BY_PERSPECTIVE[annotation.perspective]);
  button.textContent = ICON_BY_PERSPECTIVE[annotation.perspective];
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    openBubble(button, annotation, onFollowUp);
  });
  // Place the icon immediately after the annotated node.
  node.insertAdjacentElement('afterend', button);
  return { button };
}

/** The icon anchor currently owning an open bubble (for outside-click guards). */
let _activeAnchor: HTMLElement | null = null;

function openBubble(anchor: HTMLElement, annotation: Annotation, onFollowUp?: (comment: string) => void): void {
  const host = getBubbleHost();
  const layer = host.shadowRoot!.querySelector('.anno-bubble-layer')!;
  // Close any existing bubble (only one at a time).
  layer.innerHTML = '';

  const bubble = document.createElement('div');
  bubble.className = `anno-bubble ${annotation.perspective}`;
  bubble.innerHTML = `
    <div class="anno-bubble-header">
      <span>${ICON_BY_PERSPECTIVE[annotation.perspective]}</span>
      <span class="anno-bubble-label">${LABEL_BY_PERSPECTIVE[annotation.perspective]}</span>
      <button class="anno-bubble-close" type="button" aria-label="close">✕</button>
    </div>
    <div class="anno-comment"></div>
    <button class="anno-followup" type="button">↩ 在对话中追问</button>
  `;
  // Set comment text safely (avoid HTML injection).
  (bubble.querySelector('.anno-comment') as HTMLElement).textContent = annotation.comment;

  // Position below the anchor using DOCUMENT coordinates. Because the host is
  // position:absolute at the document origin, absolute left/top here are
  // document-relative — so the bubble scrolls naturally with the page.
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left + window.scrollX, document.documentElement.scrollWidth - 320 - 8));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${rect.bottom + window.scrollY + 6}px`;
  layer.appendChild(bubble);

  _activeAnchor = anchor;

  const close = () => {
    layer.innerHTML = '';
    _activeAnchor = null;
    document.removeEventListener('click', onDocClick);
  };
  const onDocClick = (ev: MouseEvent) => {
    const target = ev.target as Node;
    // Ignore clicks on the anchor itself (it has its own stopPropagation handler
    // anyway) and anything inside the bubble.
    if (_activeAnchor && _activeAnchor.contains(target)) return;
    if (bubble.contains(target)) return;
    close();
  };
  (bubble.querySelector('.anno-bubble-close') as HTMLElement).addEventListener('click', (ev) => {
    ev.stopPropagation();
    close();
  });
  (bubble.querySelector('.anno-followup') as HTMLElement).addEventListener('click', (ev) => {
    ev.stopPropagation();
    onFollowUp?.(annotation.comment);
    close();
  });
  // Attach synchronously so a subsequent outside click (e.g. document.body.click()
  // right after) closes the bubble. The anchor's own click handler calls
  // stopPropagation, so opening the bubble won't immediately trigger onDocClick.
  document.addEventListener('click', onDocClick);
}

// --- Orchestration: start/clear annotation flow ---

/** Active annotation state, reset between runs. */
let _running = false;

export function resetAnnotationState(): void {
  _running = false;
}

/** Report an event back to the side panel via runtime messaging. */
function reportToPanel(msg: { action: string; [k: string]: unknown }): void {
  try { chrome.runtime.sendMessage(msg); } catch { /* context invalidated */ }
}

/** Max number of chunks annotated concurrently. Caps API load + DOM churn. */
const CONCURRENCY = 4;

/**
 * Begin annotating the page: collect chunks, request annotations per chunk
 * with bounded concurrency (CONCURRENCY at a time), highlight + insert icons
 * progressively, and report progress.
 * Reports annotationProgress / annotationDone / annotationFailed to the panel.
 *
 * Cancellation: if handleClearAnnotation runs mid-flight, in-flight ports are
 * disconnected and results arriving after clear are dropped (no orphan icons).
 */
export async function handleStartAnnotation(): Promise<void> {
  if (_running) return;
  _running = true;

  const chunks = collectChunks(document);
  const fullArticle = buildFullArticle(chunks);
  const total = chunks.length;
  reportToPanel({ action: 'annotationProgress', done: 0, total });

  let produced = 0;
  let completed = 0;

  // One task per chunk; the pool runs up to CONCURRENCY concurrently.
  const runOne = async (i: number): Promise<void> => {
    if (!_running) return;
    const result = await requestChunk(fullArticle, i, chunks[i].text);
    // A clear may have landed while this chunk was in flight — drop the result
    // so no icon is inserted after clear.
    if (!_running) return;
    if (result === 'failed') {
      reportToPanel({ action: 'annotationFailed', chunkIndex: i });
    } else if (result && result.length > 0) {
      for (const ann of result) {
        findAndWrap(chunks[i].node, ann.quote);
        // Even if the quote didn't match, attach the icon to the paragraph so the
        // annotation is still reachable (degraded, per spec §6.1).
        createIconFor(chunks[i].node, ann, (comment) =>
          reportToPanel({ action: 'annotationFollowUp', text: comment }),
        );
        produced += 1;
      }
    }
    completed += 1;
    reportToPanel({ action: 'annotationProgress', done: completed, total });
  };

  // Bounded-concurrency pool: feed indices into at most CONCURRENCY workers.
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (_running) {
      const i = nextIndex++;
      if (i >= chunks.length) return;
      await runOne(i);
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker);
  await Promise.all(workers);

  // Only report done if we finished naturally (not cancelled by a clear).
  if (_running) reportToPanel({ action: 'annotationDone', count: produced });
  _running = false;
}

/** In-flight annotation ports, tracked so handleClearAnnotation can abort them. */
const _activePorts = new Set<chrome.runtime.Port>();

/**
 * Request annotations for one chunk via the background 'annotation' port.
 * Returns the parsed Annotation[] on success, or 'failed' on error/disconnect.
 * The port is tracked in _activePorts so a mid-flight clear can disconnect it.
 */
function requestChunk(fullArticle: string, chunkIndex: number, chunkText: string): Promise<Annotation[] | 'failed'> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'annotation' });
    _activePorts.add(port);
    const cleanup = () => { _activePorts.delete(port); port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect); };
    const onMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'annotated') {
        cleanup();
        port.disconnect();
        resolve((msg.annotations as Annotation[]) || []);
      } else if (msg.type === 'error') {
        cleanup();
        port.disconnect();
        resolve('failed');
      }
    };
    const onDisconnect = () => { cleanup(); resolve('failed'); };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage({ type: 'annotate', fullArticle, chunkIndex, chunkText });
  });
}

/** Remove every annotation artifact from the page (marks, icons, bubbles).
 *  Also aborts any in-flight annotation ports so no late icon is inserted. */
export function handleClearAnnotation(): void {
  _running = false;
  // Abort in-flight requests: disconnecting fires onDisconnect, which resolves
  // each requestChunk promise with 'failed'. The orchestration loop then drops
  // the result via its post-await _running check.
  _activePorts.forEach((port) => { try { port.disconnect(); } catch { /* already gone */ } });
  _activePorts.clear();
  // Unwrap marks: replace each <mark.anno-mark> with its children.
  document.querySelectorAll('mark.anno-mark').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
  document.querySelectorAll('.anno-icon').forEach((icon) => icon.remove());
  const host = getBubbleHost();
  const layer = host.shadowRoot?.querySelector('.anno-bubble-layer');
  if (layer) layer.innerHTML = '';
}

// --- Page-injected CSS (highlight + icon styles) ---

/** Page-injected highlight/icon styles. Kept as a string so the IIFE bundle
 *  includes them without a separate fetch. Mirrors src/content/annotation.css. */
export const ANNOTATION_CSS = `
.anno-mark { background: #fff3bf; border-radius: 2px; padding: 0 1px; box-shadow: inset 0 -2px 0 rgba(255,193,7,0.5); }
.anno-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin: 0 2px; border: 1px solid rgba(0,0,0,0.12); border-radius: 50%; background: #fff; cursor: pointer; font-size: 12px; line-height: 1; vertical-align: middle; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.anno-icon:hover { transform: scale(1.12); }
.anno-icon-critique { background: #fff7e6; }
.anno-icon-counterpoint { background: #e8f7ef; }
.anno-icon-flaw { background: #fff1f0; }
`;

let _cssInjected = false;

/** Inject the highlight/icon stylesheet into the page head once. */
export function injectAnnotationCSS(): void {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'anno-styles';
  style.textContent = ANNOTATION_CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}
