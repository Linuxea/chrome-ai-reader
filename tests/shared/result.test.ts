/**
 * Tests for shared/result.ts — Result<T,E> value constructors.
 *
 * Used by page-extractor.ts and podcast/index.ts for error-safe returns.
 * Pure functions, no dependencies.
 */
import { describe, it, expect } from 'vitest';
import { ok, err } from '../../src/shared/result';

describe('shared/result', () => {
  describe('ok()', () => {
    it('returns an ok Result with the given value', () => {
      const result = ok('hello');
      expect(result.ok).toBe(true);
      expect(result).toHaveProperty('value', 'hello');
    });

    it('works with objects', () => {
      const result = ok({ text: 'page content', title: 'Test' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('page content');
      }
    });

    it('works with null/undefined values', () => {
      expect(ok(null).ok).toBe(true);
      expect(ok(undefined).ok).toBe(true);
    });

    it('works with numeric values', () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(42);
    });
  });

  describe('err()', () => {
    it('returns an error Result with the given error', () => {
      const result = err(new Error('something went wrong'));
      expect(result.ok).toBe(false);
      expect(result).toHaveProperty('error');
    });

    it('works with string errors', () => {
      const result = err('simple error message');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('simple error message');
    });

    it('works with custom error types', () => {
      const customErr = { code: 500, detail: 'server error' };
      const result = err(customErr);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toEqual(customErr);
    });
  });

  describe('ok/err type discrimination', () => {
    it('ok and err produce mutually exclusive shapes', () => {
      const success = ok('data');
      const failure = err('bad');

      // ok Result has 'value', NOT 'error'
      expect(success).toHaveProperty('value');
      expect(success).not.toHaveProperty('error');

      // err Result has 'error', NOT 'value'
      expect(failure).toHaveProperty('error');
      expect(failure).not.toHaveProperty('value');
    });
  });
});
