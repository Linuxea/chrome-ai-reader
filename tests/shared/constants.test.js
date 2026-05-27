import { vi, describe, it, expect } from 'vitest';

// Mock i18n — safeTruncate depends on t() for the default suffix
vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

import { safeTruncate } from '../../src/shared/constants.js';

describe('safeTruncate', () => {
  it('returns text unchanged when within limit', () => {
    expect(safeTruncate('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when exactly at limit', () => {
    const text = 'a'.repeat(10);
    expect(safeTruncate(text, 10)).toBe(text);
  });

  it('truncates and appends default suffix when over limit', () => {
    const text = 'a'.repeat(20);
    const result = safeTruncate(text, 10);
    expect(result).toBe('a'.repeat(10) + '[ai.truncated]');
  });

  it('respects newline boundaries by looking back up to 200 chars', () => {
    // Build text: 300 chars, with a newline at position 250
    const before = 'a'.repeat(249);   // 249 chars
    const nl = '\n';                   // 1 char (position 249)
    const after = 'b'.repeat(50);      // 50 chars  → total 300
    const text = before + nl + after;  // 300 chars

    // Truncate at 280 → last 200 chars include the newline at relative pos 1
    const result = safeTruncate(text, 280);
    // Should cut at the newline position (250) + suffix
    expect(result).toBe(before + nl + '[ai.truncated]');
  });

  it('uses custom suffix when provided', () => {
    const text = 'a'.repeat(20);
    const result = safeTruncate(text, 10, '...');
    expect(result).toBe('a'.repeat(10) + '...');
  });

  it('returns null as-is', () => {
    expect(safeTruncate(null, 10)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(safeTruncate(undefined, 10)).toBeUndefined();
  });

  it('returns empty string as-is', () => {
    expect(safeTruncate('', 10)).toBe('');
  });

  it('truncates at exactly maxLen chars when no newline in lookback', () => {
    // 50 chars with no newline — lookback is min(200, 30) = 30, all 'a's
    const text = 'a'.repeat(50);
    expect(safeTruncate(text, 30)).toBe('a'.repeat(30) + '[ai.truncated]');
  });

  it('handles multi-byte characters correctly (spread operator)', () => {
    // Emoji are multi-byte but single codepoint via spread
    const text = '😀'.repeat(20); // 20 emoji
    const result = safeTruncate(text, 10);
    expect(result).toBe('😀'.repeat(10) + '[ai.truncated]');
  });
});
