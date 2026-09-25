/**
 * Token usage accounting (F9) — writes the per-day, per-model totals in
 * chrome.storage.local. Writes are serialized: parallel requests
 * (annotation runs four at a time) must not lose each other's increments.
 */

import type { TokenUsage } from '../shared/protocol';
import { USAGE_KEY, addUsage, dayKey, type UsageStats } from '../shared/usage-stats';

export { addUsage, dayKey, USAGE_KEY, USAGE_RETENTION_DAYS } from '../shared/usage-stats';

let queue: Promise<void> = Promise.resolve();

export function recordUsage(model: string, usage: TokenUsage): Promise<void> {
  queue = queue.then(async () => {
    const data = await chrome.storage.local.get(USAGE_KEY);
    const stats = (data[USAGE_KEY] as UsageStats | undefined) ?? {};
    await chrome.storage.local.set({ [USAGE_KEY]: addUsage(stats, dayKey(), model, usage) });
  }).catch((e: unknown) => console.error('usage accounting failed:', e));
  return queue;
}
