import { t } from './i18n.js';

export const TRUNCATE_LIMITS = {
  CONTEXT: 64000,
  QUOTE: 64000,
} as const;

export function safeTruncate(text: string | undefined | null, maxLen: number, suffix?: string): string | undefined | null {
  if (!text) return text;
  const chars = [...text];
  if (chars.length <= maxLen) return text;
  const truncSuffix = suffix || t('ai.truncated');
  const truncated = chars.slice(0, maxLen).join('');
  const lookback = Math.min(200, maxLen);
  const tail = truncated.slice(-lookback);
  const lastBreak = tail.lastIndexOf('\n');
  if (lastBreak > 0) {
    return truncated.slice(0, truncated.length - lookback + lastBreak + 1) + truncSuffix;
  }
  return truncated + truncSuffix;
}

// DOM-based implementation — handles all HTML entities natively
export function escapeHtml(text: string | undefined | null): string | undefined | null {
  if (!text) return text;
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
