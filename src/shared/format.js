import { t, getCurrentLang } from './i18n.js';

/**
 * Format a timestamp into a human-readable relative date string.
 * Shows "Today HH:MM", "Yesterday HH:MM", or "M/D HH:MM".
 * @param {number|string|Date} timestamp - Value parseable by the Date constructor
 * @returns {string} Localized date-time string
 */
export function formatDate(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const locale = getCurrentLang() === 'en' ? 'en-US' : 'zh-CN';
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  if (isToday) return t('chat.today') + ' ' + time;
  if (isYesterday) return t('chat.yesterday') + ' ' + time;
  return d.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }) + ' ' + time;
}

/**
 * Format seconds into M:SS display format.
 * Used by podcast player and TTS.
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted string like "3:05"
 */
export function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
