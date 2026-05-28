import { t, getCurrentLang } from './i18n.js';

/**
 * Format a timestamp into a human-readable relative date string.
 * Shows "Today HH:MM", "Yesterday HH:MM", or "M/D HH:MM".
 */
export function formatDate(timestamp: number | string | Date): string {
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
 */
export function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format a Date as "YYYY-MM-DD HH:MM".
 * Used by chat history export and outline export.
 */
export function formatDateTime(date: Date): string {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0') + ' ' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
}

/**
 * Format a Date as "YYYY-MM-DD".
 * Used by file download naming.
 */
export function formatDateOnly(date: Date): string {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}
