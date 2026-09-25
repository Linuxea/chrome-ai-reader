/**
 * Token usage statistics (F9): per day, per model, stored by the worker in
 * chrome.storage.local (`usageStats`) and shown on the options page. Pure.
 */

import type { TokenUsage } from './protocol';

export const USAGE_KEY = 'usageStats';
/** Days of history kept. */
export const USAGE_RETENTION_DAYS = 90;

export interface UsageEntry { requests: number; inputTokens: number; outputTokens: number }
/** day (YYYY-MM-DD, local time) → model → totals */
export type UsageStats = Record<string, Record<string, UsageEntry>>;

export function dayKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add one request's usage, dropping days beyond the retention window. */
export function addUsage(stats: UsageStats, day: string, model: string, usage: TokenUsage): UsageStats {
  const next: UsageStats = { ...stats, [day]: { ...(stats[day] ?? {}) } };
  const cur = next[day][model] ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
  next[day][model] = {
    requests: cur.requests + 1,
    inputTokens: cur.inputTokens + usage.inputTokens,
    outputTokens: cur.outputTokens + usage.outputTokens,
  };
  const days = Object.keys(next).sort();
  for (const old of days.slice(0, Math.max(0, days.length - USAGE_RETENTION_DAYS))) delete next[old];
  return next;
}

export interface UsageRow { model: string; requests: number; inputTokens: number; outputTokens: number }

/** Per-model totals over the last `days` days (including today), largest first. */
export function summarizeUsage(stats: UsageStats, days: number, today = new Date()): UsageRow[] {
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  const fromKey = dayKey(from);
  const totals = new Map<string, UsageRow>();
  for (const [day, models] of Object.entries(stats)) {
    if (day < fromKey || day > dayKey(today)) continue;
    for (const [model, e] of Object.entries(models)) {
      const row = totals.get(model) ?? { model, requests: 0, inputTokens: 0, outputTokens: 0 };
      row.requests += e.requests;
      row.inputTokens += e.inputTokens;
      row.outputTokens += e.outputTokens;
      totals.set(model, row);
    }
  }
  return [...totals.values()].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
}
