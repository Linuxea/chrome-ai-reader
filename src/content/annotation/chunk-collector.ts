/**
 * Chunk collection — extract ordered paragraph chunks from a page for
 * annotation. Pure DOM text extraction; no state, no network.
 *
 * Extracted from the former god module content/annotation.ts so the
 * collection logic can be tested and reused independently of the
 * orchestration and bubble UI.
 */

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

/**
 * Build the full-article context string from collected chunks. The "[#N]"
 * labels are language-neutral; the `annotation.user` prompt (zh and en)
 * refers to the target paragraph by the same label.
 */
export function buildFullArticle(chunks: CollectedChunk[]): string {
  return chunks.map((c, i) => `[#${i}] ${c.text}`).join('\n\n');
}

/** Characters of the article's opening every chunk request carries. */
export const CONTEXT_HEAD_CHARS = 1500;
/** Paragraphs on each side of the target included as local context. */
export const CONTEXT_NEIGHBORS = 3;
/** Hard cap on one chunk's context. */
export const CONTEXT_MAX_CHARS = 8000;

/**
 * Context for annotating chunk `index`: the article's opening (what it is
 * about) plus the paragraphs around the target — instead of the full
 * article per request, which made a run cost paragraphs × article length.
 * Omitted stretches are marked with "…". Labels match buildFullArticle.
 */
export function buildChunkContext(chunks: CollectedChunk[], index: number): string {
  const include = new Set<number>();
  let headChars = 0;
  for (let i = 0; i < chunks.length && headChars < CONTEXT_HEAD_CHARS; i++) {
    include.add(i);
    headChars += chunks[i].text.length;
  }
  for (let i = Math.max(0, index - CONTEXT_NEIGHBORS); i <= Math.min(chunks.length - 1, index + CONTEXT_NEIGHBORS); i++) include.add(i);

  const parts: string[] = [];
  let prev = -1;
  let total = 0;
  for (const i of [...include].sort((a, b) => a - b)) {
    if (prev !== -1 && i !== prev + 1) parts.push('…');
    const piece = `[#${i}] ${chunks[i].text}`;
    // Past the cap only the target itself is still added.
    if (total + piece.length > CONTEXT_MAX_CHARS && i !== index) { prev = i; continue; }
    parts.push(piece);
    total += piece.length;
    prev = i;
  }
  return parts.join('\n\n');
}
