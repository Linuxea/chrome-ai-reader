import { useEffect, useRef, useState } from 'react';

export const FLUSH_INTERVAL_MS = 80;

/**
 * Throttle fast-changing text (streaming chunks) for expensive rendering —
 * React port of answer-view's flush cadence: marked over the full text is
 * O(n), running it per SSE chunk makes a long answer O(n²) CPU. Renders at
 * most every `intervalMs`; the pending timer always flushes the LATEST text.
 */
export function useThrottledText(text: string, intervalMs = FLUSH_INTERVAL_MS): string {
  const [throttled, setThrottled] = useState(text);
  const textRef = useRef(text);
  textRef.current = text;
  const lastFlushRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (text === throttled) return;
    const elapsed = performance.now() - lastFlushRef.current;
    if (elapsed >= intervalMs) {
      lastFlushRef.current = performance.now();
      setThrottled(text);
      return;
    }
    if (timerRef.current !== null) return; // the pending timer picks it up
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastFlushRef.current = performance.now();
      setThrottled(textRef.current);
    }, intervalMs - elapsed);
  }, [text, throttled, intervalMs]);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  return throttled;
}
