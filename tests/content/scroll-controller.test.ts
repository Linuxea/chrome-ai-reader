import { vi, describe, it, expect, beforeEach } from 'vitest';

import { scrollBegin, scrollNext, scrollRestore } from '../../src/content/scroll-controller';

/** Mirror the module's scrolling-element fallback (jsdom: scrollingElement is undefined). */
function scrollEl(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** jsdom does no layout: rig the scrolling element with controlled metrics. */
function rigPage(opts: { innerHeight: number; scrollHeight: number }): void {
  const el = scrollEl();
  Object.defineProperty(el, 'scrollHeight', {
    value: opts.scrollHeight, configurable: true, writable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: opts.innerHeight, configurable: true, writable: true,
  });
  el.scrollTop = 0;
}

describe('content/scroll-controller', () => {
  beforeEach(() => {
    rigPage({ innerHeight: 800, scrollHeight: 4000 });
    document.documentElement.style.scrollBehavior = '';
    document.documentElement.scrollTop = 1234;
  });

  it('begin jumps to top, forces instant scrolling and reports metrics', async () => {
    const state = await scrollBegin(0);

    expect(scrollEl().scrollTop).toBe(0);
    expect(scrollEl().style.scrollBehavior).toBe('auto');
    expect(state).toEqual({ y: 0, innerHeight: 800, scrollHeight: 4000, atBottom: false });
  });

  it('begin reports atBottom for a page shorter than the viewport', async () => {
    rigPage({ innerHeight: 900, scrollHeight: 700 });

    const state = await scrollBegin(0);

    expect(state.atBottom).toBe(true);
  });

  it('next advances exactly one viewport height', async () => {
    await scrollBegin(0);

    const state = await scrollNext(0);

    expect(scrollEl().scrollTop).toBe(800);
    expect(state.y).toBe(800);
    expect(state.atBottom).toBe(false);
  });

  it('next detects the bottom (with rounding tolerance)', async () => {
    await scrollBegin(0);
    const el = scrollEl();
    el.scrollTop = 4000 - 800 + 0.5; // last screen, fractional overshoot

    const state = await scrollNext(0);

    // jsdom does not clamp scrollTop; atBottom math must still hold
    expect(state.atBottom).toBe(true);
  });

  it('restore returns to the saved position and clears the behavior override', async () => {
    document.documentElement.style.scrollBehavior = 'smooth';
    await scrollBegin(0);
    await scrollNext(0);

    await scrollRestore();

    expect(scrollEl().scrollTop).toBe(1234);
    expect(scrollEl().style.scrollBehavior).toBe('smooth');
  });
});
