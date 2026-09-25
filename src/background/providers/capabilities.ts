/**
 * Optional request fields a given endpoint+model rejected, remembered for the
 * worker's lifetime so a long run (e.g. annotating 40 paragraphs) pays for
 * the failed attempt once instead of on every request.
 */

export type Capability = 'jsonMode' | 'streamUsage';

const issues = new Map<string, Set<Capability>>();

export function hasCapabilityIssue(key: string, cap: Capability): boolean {
  return issues.get(key)?.has(cap) ?? false;
}

export function markCapabilityIssue(key: string, cap: Capability): void {
  if (!issues.has(key)) issues.set(key, new Set());
  issues.get(key)!.add(cap);
}

/** Test accessor. */
export function __resetCapabilities(): void {
  issues.clear();
}
