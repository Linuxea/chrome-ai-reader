/**
 * F15: the `latest_reminder` line the worker sends with a web search request
 * (docs: api-docs.deepseek.com/zh-cn/guides/latest_reminder).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildLatestReminder } from '../../src/shared/latest-reminder';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('buildLatestReminder', () => {
  // A Monday, built in local time so the assertions hold in any timezone.
  const monday = new Date(2026, 10, 23, 12, 0, 0);

  it('formats the five comma-separated fields in the UI language', () => {
    expect(buildLatestReminder('zh', monday)).toBe('2026-11-23,星期一,,Web,中文');
    expect(buildLatestReminder('en', monday)).toBe('2026-11-23,Monday,,Web,English');
  });

  it('defaults to zh for any non-en language, like getPrompt', () => {
    expect(buildLatestReminder(monday)).toBe('2026-11-23,星期一,,Web,中文');
    expect(buildLatestReminder('fr', monday)).toBe('2026-11-23,星期一,,Web,中文');
  });

  it('zero-pads month and day', () => {
    expect(buildLatestReminder('en', new Date(2026, 0, 5, 9))).toBe('2026-01-05,Monday,,Web,English');
  });

  it('uses the local calendar date, not UTC', () => {
    // 17:00Z on the 22nd is already the 23rd in UTC+8: the date must follow
    // the wall clock the user sees (the official chat-demo does the same).
    process.env.TZ = 'Asia/Shanghai';
    expect(buildLatestReminder('en', new Date('2026-11-22T17:00:00Z'))).toBe('2026-11-23,Monday,,Web,English');
    process.env.TZ = 'UTC';
    expect(buildLatestReminder('en', new Date('2026-11-22T17:00:00Z'))).toBe('2026-11-22,Sunday,,Web,English');
  });

  it('leaves the location empty and names the platform Web', () => {
    const fields = buildLatestReminder('en', monday).split(',');
    expect(fields).toHaveLength(5);
    expect(fields[2]).toBe('');
    expect(fields[3]).toBe('Web');
  });
});
