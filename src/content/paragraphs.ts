/**
 * Paragraph segmentation of an article for context building and citations.
 * The side panel labels these "[#N]"; a citation click sends paragraph N's
 * text back, and highlightParagraph() finds it again in the live page.
 */

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dd, dt, figcaption';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Leaf-most block texts under `root`, in document order. */
export function extractParagraphs(root: ParentNode, minChars = 1): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
    // Skip containers of other blocks (e.g. an <li> wrapping <p>s): the inner blocks count.
    if (el.querySelector(BLOCK_SELECTOR)) continue;
    if (el.closest('nav, footer, aside, script, style, noscript')) continue;
    const text = norm(el.textContent || '');
    if (text.length >= minChars) out.push(text);
  }
  return out;
}

/** Paragraphs of a Readability `content` HTML string (parsed inertly). */
export function paragraphsFromHtml(html: string): string[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return extractParagraphs(doc.body);
}

let _flashTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Scroll to and briefly highlight the live element whose text best matches
 * `text` (a paragraph from extraction). Returns false when not found.
 */
export function highlightParagraph(text: string, root: ParentNode = document): boolean {
  const target = norm(text);
  if (!target) return false;
  const probe = target.slice(0, 60);
  let best: HTMLElement | null = null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
    if (el.querySelector(BLOCK_SELECTOR)) continue;
    const t = norm(el.textContent || '');
    if (t === target) { best = el; break; }
    if (!best && t.includes(probe)) best = el;
  }
  if (!best) return false;
  best.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  const prev = best.style.backgroundColor;
  const prevTransition = best.style.transition;
  best.style.transition = 'background-color 0.6s';
  best.style.backgroundColor = 'rgba(255, 213, 79, 0.55)';
  clearTimeout(_flashTimer);
  const el = best;
  _flashTimer = setTimeout(() => { el.style.backgroundColor = prev; el.style.transition = prevTransition; }, 2400);
  return true;
}
