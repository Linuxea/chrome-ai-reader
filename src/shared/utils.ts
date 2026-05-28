/**
 * Safely extract an error message from any caught value.
 * Replaces the repeated `(e as Error).message` pattern across the codebase.
 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e !== null && e !== undefined) return String(e);
  return 'Unknown error';
}
