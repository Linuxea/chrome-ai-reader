import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/shared/format.js';

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
