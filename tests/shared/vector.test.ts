import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findRelatedRecords } from '../../src/shared/vector';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 5);
  });

  it('returns ~1.0 for nearly identical vectors', () => {
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.15, 0.25, 0.35, 0.45];
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.99);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for different length vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('handles negative values', () => {
    const a = [-0.5, 0.3, -0.2];
    const b = [-0.4, 0.4, -0.1];
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.9);
  });
});

describe('findRelatedRecords', () => {
  const rec = (url, embedding, timestamp = 0) => ({
    id: url, url, normalizedUrl: url, title: url, excerpt: '', embedding, timestamp,
  });

  it('returns empty when the target has no record', () => {
    expect(findRelatedRecords([rec('https://a.com', [1, 0])], 'https://b.com', 0.5, 5)).toEqual([]);
  });

  it('returns empty when the target record has no embedding', () => {
    const records = [{ ...rec('https://a.com', []), embedding: undefined }];
    expect(findRelatedRecords(records, 'https://a.com', 0.5, 5)).toEqual([]);
  });

  it('excludes the target itself and filters below threshold', () => {
    const records = [
      rec('https://current.com', [1, 0, 0]),
      rec('https://related.com', [1, 0.1, 0]),
      rec('https://unrelated.com', [0, 1, 0]),
    ];
    const result = findRelatedRecords(records, 'https://current.com', 0.7, 5);
    expect(result).toHaveLength(1);
    expect(result[0].record.url).toBe('https://related.com');
    expect(result[0].similarity).toBeGreaterThan(0.9);
  });

  it('sorts by similarity descending and limits results', () => {
    const records = [rec('https://current.com', [1, 0, 0])];
    for (let i = 1; i <= 10; i++) records.push(rec(`https://p${i}.com`, [1, 0.1 * i, 0]));
    const result = findRelatedRecords(records, 'https://current.com', 0.5, 5);
    expect(result).toHaveLength(5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity);
    }
  });

  it('skips records without embeddings', () => {
    const records = [
      rec('https://current.com', [1, 0]),
      { ...rec('https://noemb.com', []), embedding: undefined },
      rec('https://related.com', [1, 0.1]),
    ];
    const result = findRelatedRecords(records, 'https://current.com', 0.5, 5);
    expect(result.map((r) => r.record.url)).toEqual(['https://related.com']);
  });
});
