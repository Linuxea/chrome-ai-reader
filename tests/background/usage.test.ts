import { describe, it, expect } from 'vitest';
import { addUsage, dayKey, USAGE_RETENTION_DAYS } from '../../src/background/usage';

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
