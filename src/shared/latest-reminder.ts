/**
 * F15: the `latest_reminder` message DeepSeek's chat API accepts — it tells
 * the model today's date and the user's language. Without it the model cannot
 * know the date (verified live, 2026-11-23: asked for the date with the web
 * tool declared and no reminder, it declined; with the reminder it answered
 * correctly), and "latest / recent" questions drift onto stale pages.
 *
 * Wire format (docs: guides/latest_reminder):
 *   YYYY-MM-DD,<weekday>,<location>,<platform>,<language>
 * e.g. `2026-11-23,Monday,Singapore,Web,English`
 *
 * - the date and weekday use the machine's local timezone (the official demo
 *   does the same, so a UTC evening is not "tomorrow");
 * - location is optional and left empty — this extension never asks for it;
 * - platform is `Web`;
 * - the language is written in that language (`中文` / `English`).
 *
 * The message must sit directly before the `user` message it belongs to.
 */

import { REMINDER_LANGUAGE, type Lang } from './prompts';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Build the reminder line for `now` in the UI language (defaults to zh, like getPrompt). */
export function buildLatestReminder(lang: string = 'zh', now: Date = new Date()): string {
  const resolved: Lang = lang === 'en' ? 'en' : 'zh';
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // The weekday name comes from Intl, in the reminder's own language.
  const weekday = new Intl.DateTimeFormat(resolved === 'en' ? 'en-US' : 'zh-CN', { weekday: 'long' }).format(now);
  return [date, weekday, '', 'Web', REMINDER_LANGUAGE[resolved]].join(',');
}
