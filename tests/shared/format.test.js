import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
  getCurrentLang: vi.fn(() => 'zh'),
}));

import { formatDuration, formatDate, formatDateTime, formatDateOnly } from '../../src/shared/format.js';

describe('formatDuration', () => {
  it('formats 0 seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats 65 seconds as 1:05', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('formats 3600 seconds as 60:00', () => {
    expect(formatDuration(3600)).toBe('60:00');
  });

  it('formats 30 seconds as 0:30', () => {
    expect(formatDuration(30)).toBe('0:30');
  });

  it('formats 59 seconds as 0:59', () => {
    expect(formatDuration(59)).toBe('0:59');
  });

  it('returns 0:00 for null', () => {
    expect(formatDuration(null)).toBe('0:00');
  });

  it('returns 0:00 for undefined', () => {
    expect(formatDuration(undefined)).toBe('0:00');
  });

  it('returns 0:00 for NaN', () => {
    expect(formatDuration(NaN)).toBe('0:00');
  });

  it('returns 0:00 for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0:00');
  });

  it('floors fractional seconds', () => {
    expect(formatDuration(65.9)).toBe('1:05');
  });
});

describe('formatDate', () => {
  it('returns today prefix for today\'s timestamp', () => {
    const now = new Date();
    const result = formatDate(now.getTime());
    expect(result).toMatch(/^\[chat\.today\] \d{2}:\d{2}$/);
  });

  it('returns yesterday prefix for yesterday\'s timestamp', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = formatDate(yesterday.getTime());
    expect(result).toMatch(/^\[chat\.yesterday\] \d{2}:\d{2}$/);
  });

  it('returns date+time for older timestamps', () => {
    const old = new Date('2024-01-15T10:30:00');
    const result = formatDate(old.getTime());
    // zh-CN locale: "1/15 10:30" format
    expect(result).toContain('10:30');
    expect(result).not.toContain('[chat.today]');
    expect(result).not.toContain('[chat.yesterday]');
  });

  it('accepts Date object as input', () => {
    const now = new Date();
    const result = formatDate(now);
    expect(result).toMatch(/^\[chat\.today\] \d{2}:\d{2}$/);
  });

  it('accepts string timestamp as input', () => {
    const now = new Date();
    const result = formatDate(now.toISOString());
    expect(result).toMatch(/^\[chat\.today\] \d{2}:\d{2}$/);
  });
});

describe('formatDateTime', () => {
  it('formats date as YYYY-MM-DD HH:MM', () => {
    const date = new Date(2026, 0, 15, 10, 30); // Jan 15, 2026 10:30
    const result = formatDateTime(date);
    expect(result).toBe('2026-01-15 10:30');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2026, 2, 5, 8, 5); // Mar 5, 2026 08:05
    const result = formatDateTime(date);
    expect(result).toBe('2026-03-05 08:05');
  });
});

describe('formatDateOnly', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2026, 0, 15);
    const result = formatDateOnly(date);
    expect(result).toBe('2026-01-15');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2026, 2, 5);
    const result = formatDateOnly(date);
    expect(result).toBe('2026-03-05');
  });
});
