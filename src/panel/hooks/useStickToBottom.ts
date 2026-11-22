import { useCallback, useEffect, useRef } from 'react';

/**
 * Stick-to-bottom scrolling for the chat area — React port of the legacy
 * auto-scroll policy:
 * - while the user is pinned near the bottom, content growth (streaming
 *   chunks, new bubbles) keeps the view at the bottom;
 * - once the user scrolls up to read, growth stops following (their reading
 *   position is sacred) until they return near the bottom.
 *
 * The container element is provided as a CALLBACK REF: the chat area is
 * remounted per tab (keyed), and a callback ref re-binds the scroll
 * listener to each new element — an effect with [] deps would leave the
 * listener on the first (discarded) element and stick-to-bottom would run
 * away (every chunk yanking the view back down after a remount).
 */
export function useStickToBottom<T extends HTMLElement>(deps: unknown[]): (el: T | null) => void {
  const elRef = useRef<T | null>(null);
  const stuckRef = useRef(true);
  const cleanupRef = useRef<(() => void) | null>(null);

  const setEl = useCallback((el: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    elRef.current = el;
    if (!el) return;
    stuckRef.current = true; // a fresh container starts pinned
    const onScroll = () => {
      stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    cleanupRef.current = () => el.removeEventListener('scroll', onScroll);
    el.scrollTop = el.scrollHeight; // like the legacy per-tab-switch reset
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight;
    // Deps are provided by the caller (stream text / history length).
  }, deps);

  useEffect(() => () => cleanupRef.current?.(), []);

  return setEl;
}
