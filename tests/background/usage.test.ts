import { describe, it, expect } from 'vitest';
import { addUsage, dayKey, USAGE_RETENTION_DAYS } from '../../src/shared/usage-stats';

describe('background/usage addUsage', () => {
  it('accumulates per day and model', () => {
    let s = addUsage({}, '2026-09-25', 'm', { inputTokens: 10, outputTokens: 5 });
    s = addUsage(s, '2026-09-25', 'm', { inputTokens: 1, outputTokens: 1 });
    s = addUsage(s, '2026-09-25', 'n', { inputTokens: 2, outputTokens: 2 });
    expect(s['2026-09-25']).toEqual({
      m: { requests: 2, inputTokens: 11, outputTokens: 6 },
      n: { requests: 1, inputTokens: 2, outputTokens: 2 },
    });
  });

  it('keeps only the retention window', () => {
    let s = {};
    for (let i = 0; i < USAGE_RETENTION_DAYS + 5; i++) {
      s = addUsage(s, dayKey(new Date(2026, 0, 1 + i)), 'm', { inputTokens: 1, outputTokens: 1 });
    }
    expect(Object.keys(s)).toHaveLength(USAGE_RETENTION_DAYS);
  });
});

import { summarizeUsage } from '../../src/shared/usage-stats';

describe('summarizeUsage', () => {
  it('totals per model over the window, largest first', () => {
    const today = new Date(2026, 8, 25);
    const stats = {
      '2026-09-25': { a: { requests: 1, inputTokens: 10, outputTokens: 5 }, b: { requests: 2, inputTokens: 100, outputTokens: 50 } },
      '2026-09-20': { a: { requests: 3, inputTokens: 30, outputTokens: 15 } },
      '2026-08-01': { a: { requests: 9, inputTokens: 900, outputTokens: 900 } },
    };
    expect(summarizeUsage(stats, 1, today)).toEqual([
      { model: 'b', requests: 2, inputTokens: 100, outputTokens: 50 },
      { model: 'a', requests: 1, inputTokens: 10, outputTokens: 5 },
    ]);
    expect(summarizeUsage(stats, 7, today).find((r) => r.model === 'a')).toEqual({ model: 'a', requests: 4, inputTokens: 40, outputTokens: 20 });
  });
});
