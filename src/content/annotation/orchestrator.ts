/**
 * Orchestration — start/clear annotation flow with bounded concurrency.
 *
 * Owns the per-chunk request pool (CONCURRENCY workers), the port lifecycle
 * (tracked so a mid-flight clear can abort), and the cancellation flag.
 * Delegates DOM work (chunk collection, quote wrapping, icon/bubble rendering)
 * to the sibling modules.
 *
 * Extracted from the former god module content/annotation.ts.
 */

import type { Annotation } from '../../shared/types';
import { collectChunks, buildChunkContext, buildFullArticle, type CollectedChunk } from './chunk-collector';
import { hashText, type AnnotationCacheEntry } from '../../shared/highlights';
import { normalizeUrl } from '../../shared/url-normalize';
import { findAndWrap } from './quote-wrapper';
import { createIconFor, getBubbleHost } from './bubble-ui';
import { openAnnotationPort } from '../../platform/ports';

/** Active annotation state, reset between runs. */
let _running = false;
/**
 * Generation of the current run. A cancelled run's workers resume once their
 * requests settle; they compare generations so they never touch (or end) a
 * run started after the clear.
 */
let _runGen = 0;

export function resetAnnotationState(): void {
  _running = false;
  _runGen++;
}

/** Report an event back to the side panel via runtime messaging. */
function reportToPanel(msg: { action: string; [k: string]: unknown }): void {
  try { chrome.runtime.sendMessage(msg); } catch { /* context invalidated */ }
}

/** Max number of chunks annotated concurrently. Caps API load + DOM churn. */
const CONCURRENCY = 4;

/** Per-chunk result: either parsed annotations or a forwarded error message. */
type ChunkResult = { status: 'ok'; annotations: Annotation[] } | { status: 'error'; error: string };

/**
 * Begin annotating the page: collect chunks, request annotations per chunk
 * with bounded concurrency (CONCURRENCY at a time), highlight + insert icons
 * progressively, and report progress.
 * Reports annotationProgress during the run, then a terminal event:
 *   - annotationDone {count, failed?}  — at least one chunk succeeded
 *   - annotationFailed {error}          — every chunk failed (surfaces the real error)
 *
 * Cancellation: if handleClearAnnotation runs mid-flight, in-flight ports are
 * disconnected and results arriving after clear are dropped (no orphan icons).
 */
export async function handleStartAnnotation(): Promise<void> {
  if (_running) return;
  _running = true;
  const gen = ++_runGen;
  const active = (): boolean => _running && _runGen === gen;

  const chunks = collectChunks(document);

  // F6: the same page text was annotated before — replay, no API calls.
  const cacheKey = `${normalizeUrl(location.href)}|${hashText(buildFullArticle(chunks))}`;
  const cached = await loadCache(cacheKey);
  if (!active()) return;
  if (cached) {
    let count = 0;
    for (const r of cached.results) if (chunks[r.chunkIndex]) count += renderAnnotations(chunks[r.chunkIndex], r.annotations);
    reportToPanel({ action: 'annotationProgress', done: chunks.length, total: chunks.length });
    reportToPanel({ action: 'annotationDone', count, failed: 0, cached: true });
    _running = false;
    return;
  }
  const results: AnnotationCacheEntry['results'] = [];
  const total = chunks.length;
  reportToPanel({ action: 'annotationProgress', done: 0, total });

  let produced = 0;
  let completed = 0;
  let failed = 0;
  let firstError = '';

  // One task per chunk; the pool runs up to CONCURRENCY concurrently.
  const runOne = async (i: number): Promise<void> => {
    if (!active()) return;
    const result = await requestChunk(buildChunkContext(chunks, i), i, chunks[i].text);
    // A clear may have landed while this chunk was in flight — drop the result
    // so no icon is inserted after clear.
    if (!active()) return;
    if (result.status === 'error') {
      failed += 1;
      if (!firstError) firstError = result.error;
      console.warn(`[annotation] chunk ${i} failed:`, result.error);
    } else {
      results.push({ chunkIndex: i, annotations: result.annotations });
      produced += renderAnnotations(chunks[i], result.annotations);
    }
    completed += 1;
    reportToPanel({ action: 'annotationProgress', done: completed, total });
  };

  // Bounded-concurrency pool: feed indices into at most CONCURRENCY workers.
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (active()) {
      const i = nextIndex++;
      if (i >= chunks.length) return;
      await runOne(i);
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker);
  await Promise.all(workers);

  // Only report a terminal event if we finished naturally (not cancelled).
  if (!active()) return;
  if (failed === total) {
    // Every chunk failed — surface the real error instead of a silent "0 处".
    reportToPanel({ action: 'annotationFailed', error: firstError });
  } else {
    reportToPanel({ action: 'annotationDone', count: produced, failed });
  }
  // Cache only a complete run; a partial one would replay with gaps forever.
  if (failed === 0 && total > 0) void saveCache({ key: cacheKey, results, createdAt: Date.now() });
  _running = false;
}

/** Highlight each annotation's quote in `chunk` and add its icon. Returns how many were placed. */
function renderAnnotations(chunk: CollectedChunk, annotations: Annotation[]): number {
  for (const ann of annotations) {
    const mark = findAndWrap(chunk.node, ann.quote);
    // Anchor the icon to the highlighted phrase when possible; otherwise fall
    // back to the paragraph so the annotation is still reachable (spec §6.1).
    createIconFor(mark ?? chunk.node, ann, (a) =>
      reportToPanel({ action: 'annotationFollowUp', quote: a.quote, comment: a.comment }),
    );
  }
  return annotations.length;
}

async function loadCache(key: string): Promise<AnnotationCacheEntry | undefined> {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'annotations:get', key }) as { success?: boolean; entry?: AnnotationCacheEntry } | undefined;
    return res?.success ? res.entry : undefined;
  } catch {
    return undefined;
  }
}

async function saveCache(entry: AnnotationCacheEntry): Promise<void> {
  try { await chrome.runtime.sendMessage({ action: 'annotations:save', ...entry }); } catch { /* best effort */ }
}

/**
 * In-flight chunk requests, tracked so handleClearAnnotation can cancel them.
 * Each entry disconnects its port AND settles its promise: a port's own
 * onDisconnect never fires for a disconnect() it initiated (only the worker's
 * end sees it), so cancellation cannot rely on that event.
 */
const _inFlight = new Set<() => void>();

/**
 * Request annotations for one chunk via the background 'annotation' port.
 * Returns the parsed annotations on success, or the forwarded error string on
 * failure / worker disconnect / cancellation. Always settles exactly once.
 */
function requestChunk(fullArticle: string, chunkIndex: number, chunkText: string): Promise<ChunkResult> {
  return new Promise((resolve) => {
    const port = openAnnotationPort();
    let settled = false;
    const settle = (result: ChunkResult, disconnect: boolean): void => {
      if (settled) return;
      settled = true;
      _inFlight.delete(cancel);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      if (disconnect) { try { port.disconnect(); } catch { /* already gone */ } }
      resolve(result);
    };
    const cancel = (): void => settle({ status: 'error', error: 'cancelled' }, true);
    const onMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'annotated') {
        settle({ status: 'ok', annotations: (msg.annotations as Annotation[]) || [] }, true);
      } else if (msg.type === 'error') {
        const error = (msg.error as string) || (msg.errorKey as string) || 'unknown error';
        settle({ status: 'error', error }, true);
      }
    };
    // Only fires when the worker's end goes away.
    const onDisconnect = () => settle({ status: 'error', error: 'port disconnected' }, false);
    _inFlight.add(cancel);
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage({ type: 'annotate', fullArticle, chunkIndex, chunkText });
  });
}

/** Remove every annotation artifact from the page (marks, icons, bubbles).
 *  Also aborts any in-flight annotation ports so no late icon is inserted. */
export function handleClearAnnotation(): void {
  _running = false;
  _runGen++;
  // Abort in-flight requests: each cancel disconnects its port (the worker
  // aborts the fetch) and settles its promise; the orchestration loop then
  // drops the result via its post-await _running check.
  [..._inFlight].forEach((cancel) => cancel());
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
