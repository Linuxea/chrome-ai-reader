import { describe, it, expect } from 'vitest';
import { toErrorMessage } from '../../src/shared/utils.ts';

describe('toErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(toErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('returns string as-is', () => {
    expect(toErrorMessage('string error')).toBe('string error');
  });

  it('converts number to string', () => {
    expect(toErrorMessage(42)).toBe('42');
  });

  it('converts object to string', () => {
    expect(toErrorMessage({ code: 500 })).toBe('[object Object]');
  });

  it('returns "Unknown error" for null', () => {
    expect(toErrorMessage(null)).toBe('Unknown error');
  });

  it('returns "Unknown error" for undefined', () => {
    expect(toErrorMessage(undefined)).toBe('Unknown error');
  });
});
