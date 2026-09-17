/**
 * Full-page capture scroll control — driven by the side panel over one-shot
 * tab messages (`scrollBegin` / `scrollNext` / `scrollRestore`, wired in
 * content/index.ts; orchestrated by `captureFullPage` in services/screenshot).
 *
 * begin():  remember the user's scroll position, force instant scrolling
 *           (inline `scroll-behavior:auto` beats page CSS `smooth`), jump to
 *           the top, then wait for content to settle.
 * next():   advance exactly one viewport height and wait for lazy-loaded
 *           content to render before reporting fresh metrics.
 * restore():put the page back where the user left it.
 *
 * `settleMs` is injectable so tests can pass 0 instead of waiting real time.
 */

import type { ScrollPageState } from '../shared/protocol';

/** Delay after each programmatic scroll for lazy images / late renders. */
export const DEFAULT_SETTLE_MS = 650;

/** Rounding tolerance for the atBottom check (fractional DPR / zoom). */
const BOTTOM_TOLERANCE_PX = 1;

let savedY = 0;
let savedBehavior = '';

function scrollEl(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function metrics(): ScrollPageState {
  const el = scrollEl();
  const y = el.scrollTop;
  const innerHeight = window.innerHeight;
  const scrollHeight = el.scrollHeight;
  return { y, innerHeight, scrollHeight, atBottom: y + innerHeight >= scrollHeight - BOTTOM_TOLERANCE_PX };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrollBegin(settleMs: number = DEFAULT_SETTLE_MS): Promise<ScrollPageState> {
  const el = scrollEl();
  savedY = el.scrollTop;
  savedBehavior = el.style.scrollBehavior;
  el.style.scrollBehavior = 'auto';
  el.scrollTop = 0;
  await sleep(settleMs);
  return metrics();
}

export async function scrollNext(settleMs: number = DEFAULT_SETTLE_MS): Promise<ScrollPageState> {
  const el = scrollEl();
  el.scrollTop = el.scrollTop + window.innerHeight;
  await sleep(settleMs);
  return metrics();
}

export async function scrollRestore(): Promise<void> {
  const el = scrollEl();
  el.style.scrollBehavior = savedBehavior;
  el.scrollTop = savedY;
}
