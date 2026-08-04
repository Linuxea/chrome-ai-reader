/**
 * Vector math for the related-pages feature.
 *
 * Pure functions — no chrome.*, no DOM — so they can run in the service
 * worker (sw-related-pages.ts), the side panel, and unit tests alike.
 */

import type { PageRecord, PageRelation } from './types';

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function magnitude(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

/**
 * Rank records related to `targetNormalizedUrl` by cosine similarity.
 * Returns the top `limit` relations at or above `threshold`, sorted by
 * similarity descending. The target record itself is excluded; a target
 * with no record or no embedding yields an empty list.
 */
export function findRelatedRecords(
  records: PageRecord[],
  targetNormalizedUrl: string,
  threshold: number,
  limit: number,
): PageRelation[] {
  const current = records.find((r) => r.normalizedUrl === targetNormalizedUrl);
  if (!current || !current.embedding?.length) return [];

  const relations: PageRelation[] = [];
  for (const record of records) {
    if (record.normalizedUrl === targetNormalizedUrl || !record.embedding?.length) continue;
    const similarity = cosineSimilarity(current.embedding, record.embedding);
    if (similarity >= threshold) relations.push({ record, similarity });
  }

  relations.sort((a, b) => b.similarity - a.similarity);
  return relations.slice(0, limit);
}
