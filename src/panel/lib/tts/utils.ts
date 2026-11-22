/**
 * Text preparation + segmentation for TTS.
 *
 * Segmentation is ONE greedy prefix rule (`nextCutEnd`), so feeding the text
 * incrementally (autoplay, while the answer still streams) and feeding it all
 * at once (play button / download) produce IDENTICAL boundaries. Identical
 * boundaries are what make per-segment cache keys stable across all entry
 * paths (shared/tts-cache.ts).
 */

export function stripMarkdown(text: string): string {
  return text
    .replace(/\[#\d+\]/g, '') // citation labels — not meant to be read aloud
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // tables: separator rows out, cell pipes read as pauses
    .replace(/^[ \t]*\|?[\s:|-]*\|[\s:|-]*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .trim();
}

export const SENTENCE_ENDS = '。！？.!?';

/**
 * Segment budgets (characters ≈ duration proxy for zh/en). The FIRST segment
 * is short so playback starts after one quick round trip; later segments are
 * longer to reduce per-request overhead while staying cache-friendly.
 */
export const FIRST_SEGMENT_CHARS = 60;
export const SEGMENT_CHARS = 160;
/** Hard cut when no sentence end ever arrives (e.g. an unbroken URL run). */
export const MAX_SEGMENT_CHARS = 400;

/**
 * Exclusive end index of the next cut within `text` starting at `from`, or -1
 * when no complete segment is available yet. Deterministic and prefix-local:
 * cut after the first sentence end at/after the budget, or hard-cut at the cap.
 */
export function nextCutEnd(text: string, from: number, isFirst: boolean): number {
  const budget = isFirst ? FIRST_SEGMENT_CHARS : SEGMENT_CHARS;
  for (let i = from; i < text.length; i++) {
    const len = i + 1 - from;
    if (SENTENCE_ENDS.includes(text[i]) && len >= budget) return i + 1;
    if (len >= MAX_SEGMENT_CHARS) return i + 1;
  }
  return -1;
}

/** Batch segmentation of ALREADY-STRIPPED text (call stripMarkdown first). */
export function splitToSegments(text: string): string[] {
  const segments: string[] = [];
  let pos = 0;
  let isFirst = true;
  while (pos < text.length) {
    const cut = nextCutEnd(text, pos, isFirst);
    if (cut === -1) break;
    const seg = text.slice(pos, cut).trim();
    if (seg) segments.push(seg);
    pos = cut;
    isFirst = false;
  }
  const remaining = text.slice(pos).trim();
  if (remaining) segments.push(remaining);
  return segments;
}

/**
 * Incremental segmentation of a text STREAM (autoplay): strip + cut whatever
 * is definitively complete, keep the rest buffered. Yields the same cuts as
 * `splitToSegments` on the full text: `push` returns newly completed segments
 * (already stripped), `end` returns the final tail (stripped) or null.
 *
 * Note: the buffer is re-stripped on every push, so a code fence is only
 * (correctly) dropped once it closes; a fence spanning a cut boundary may
 * still leak some code — same class of edge as before, rarer now.
 */
export function createSegmentStream(): { push(chunk: string): string[]; end(): string | null } {
  let raw = '';
  let consumed = 0;
  let isFirst = true;

  return {
    push(chunk: string): string[] {
      raw += chunk;
      const stripped = stripMarkdown(raw);
      const out: string[] = [];
      while (true) {
        const cut = nextCutEnd(stripped, consumed, isFirst);
        if (cut === -1) break;
        const seg = stripped.slice(consumed, cut).trim();
        if (seg) out.push(seg);
        consumed = cut;
        isFirst = false;
      }
      return out;
    },
    end(): string | null {
      const tail = stripMarkdown(raw).slice(consumed).trim();
      raw = '';
      consumed = 0;
      return tail || null;
    },
  };
}
