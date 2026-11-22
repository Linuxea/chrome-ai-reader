import { useEffect, useRef } from 'react';

/**
 * Stick-to-bottom scrolling for the chat area — React port of the legacy
 * auto-scroll policy:
 * - while the user is pinned near the bottom, content growth (streaming
 *   chunks, new bubbles) keeps the view at the bottom;
 * - once the user scrolls up to read, growth stops following (their reading
 *   position is sacred) until they return near the bottom.
 */
export function useStickToBottom<T extends HTMLElement>(deps: unknown[]): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const stuckRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight;
    // Deps are provided by the caller (stream text / history length).
  }, deps);

  return ref;
}
