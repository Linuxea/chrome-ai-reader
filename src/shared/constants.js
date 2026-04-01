// src/shared/constants.js
import { t } from './i18n.js';

export const TRUNCATE_LIMITS = {
  CONTEXT: 64000,
  QUOTE: 64000,
};

export function safeTruncate(text, maxLen, suffix) {
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

// DOM-based implementation from original ui-helpers.js — handles all HTML entities
export function escapeHtml(text) {
  if (!text) return text;
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
