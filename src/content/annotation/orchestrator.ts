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
import { collectChunks, buildFullArticle } from './chunk-collector';
import { findAndWrap } from './quote-wrapper';
import { createIconFor, getBubbleHost } from './bubble-ui';

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
        const mark = findAndWrap(chunks[i].node, ann.quote);
        // Anchor the icon to the highlighted phrase when possible; otherwise
        // fall back to the paragraph so the annotation is still reachable
        // (degraded, per spec §6.1).
        const anchor = mark ?? chunks[i].node;
        createIconFor(anchor, ann, (a) =>
          reportToPanel({ action: 'annotationFollowUp', quote: a.quote, comment: a.comment }),
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
