/**
 * Token usage accounting: per day, per model, in chrome.storage.local
 * (`usageStats`). Writes are serialized — parallel requests (annotation runs
 * four at a time) must not lose each other's increments.
 */

import type { TokenUsage } from '../shared/protocol';

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

/** Pure: add one request's usage, dropping days beyond the retention window. */
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

let queue: Promise<void> = Promise.resolve();

export function recordUsage(model: string, usage: TokenUsage): Promise<void> {
  queue = queue.then(async () => {
    const data = await chrome.storage.local.get(USAGE_KEY);
    const stats = (data[USAGE_KEY] as UsageStats | undefined) ?? {};
    await chrome.storage.local.set({ [USAGE_KEY]: addUsage(stats, dayKey(), model, usage) });
  }).catch((e: unknown) => console.error('usage accounting failed:', e));
  return queue;
}
