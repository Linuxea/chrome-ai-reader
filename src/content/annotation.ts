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
