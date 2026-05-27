export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
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

export function splitToSegments(text: string): string[] {
  const segments: string[] = [];
  let count = 0;
  let lastCut = 0;

  for (let i = 0; i < text.length; i++) {
    if (SENTENCE_ENDS.includes(text[i])) {
      count++;
      if (count >= 5) {
        segments.push(text.slice(lastCut, i + 1).trim());
        lastCut = i + 1;
        count = 0;
      }
    }
  }

  const remaining = text.slice(lastCut).trim();
  if (remaining) {
    segments.push(remaining);
  }

  return segments.filter(s => s.length > 0);
}
