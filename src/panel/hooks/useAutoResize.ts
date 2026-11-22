import { useEffect, useRef } from 'react';

/**
 * Auto-grow a textarea with its content, capped at `maxPx` (then it
 * scrolls). React port of the legacy inline auto-resize.
 */
export function useAutoResize(value: string, maxPx = 160): React.RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
  }, [value, maxPx]);
  return ref;
}
