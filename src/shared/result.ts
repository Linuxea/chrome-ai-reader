/**
 * Helper constructors for Result<T, E>.
 * Separated from types.ts so Rollup can tree-shake value exports correctly.
 * The Result type itself lives in types.ts — import from both as needed:
 *
 *   import type { Result } from '../shared/types';
 *   import { ok, err } from '../shared/result';
 */

import type { Result } from './types';

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
