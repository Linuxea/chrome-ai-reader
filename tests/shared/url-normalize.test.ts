import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../../src/shared/url-normalize';

describe('normalizeUrl', () => {
  it('strips the hash fragment', () => {
    expect(normalizeUrl('https://example.com/post#section')).toBe('https://example.com/post');
    expect(normalizeUrl('https://example.com/#top')).toBe('https://example.com');
  });

  it('strips utm_* tracking params', () => {
    expect(normalizeUrl('https://example.com/?utm_source=foo&utm_medium=bar')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/?utm_campaign=x&id=5')).toBe('https://example.com?id=5');
  });

  it('strips ref/source/from/gclid/fbclid/spm/si/mc_cid/mc_eid/igshid/share_*', () => {
    const stripped = ['ref', 'ref_src', 'source', 'from', 'gclid', 'fbclid', 'spm', 'si', 'mc_cid', 'mc_eid', 'igshid'];
    for (const p of stripped) {
      expect(normalizeUrl(`https://example.com/?${p}=v&keep=1`)).toBe('https://example.com?keep=1');
    }
    expect(normalizeUrl('https://example.com/?share_id=abc&keep=1')).toBe('https://example.com?keep=1');
  });

  it('is case-insensitive for tracking param names', () => {
    expect(normalizeUrl('https://example.com/?UTM_Source=foo&keep=1')).toBe('https://example.com?keep=1');
    expect(normalizeUrl('https://example.com/?GCLID=abc')).toBe('https://example.com');
  });

  it('sorts remaining params so different orders normalize the same', () => {
    expect(normalizeUrl('https://example.com/?b=2&a=1')).toBe('https://example.com?a=1&b=2');
    expect(normalizeUrl('https://example.com/?a=1&b=2')).toBe('https://example.com?a=1&b=2');
  });

  it('lowercases the host', () => {
    expect(normalizeUrl('https://EXAMPLE.com/Path')).toBe('https://example.com/Path');
  });

  it('strips trailing slash from non-root paths and normalizes root to no slash', () => {
    expect(normalizeUrl('https://example.com/post/')).toBe('https://example.com/post');
    expect(normalizeUrl('https://example.com/a/b///')).toBe('https://example.com/a/b');
    // Root path collapses to bare host (so 'https://x.com' === 'https://x.com/')
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('returns the lowercased original string when URL parsing fails', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
    expect(normalizeUrl('')).toBe('');
  });

  it('makes two equivalent visits collapse to the same key (integration of all rules)', () => {
    const a = normalizeUrl('https://Example.com/post/?utm_source=newsletter&b=2&a=1#comment-3');
    const b = normalizeUrl('https://example.com/post?a=1&b=2');
    expect(a).toBe(b);
  });

  it('preserves non-tracking query params with special characters', () => {
    expect(normalizeUrl('https://example.com/?q=hello%20world&lang=zh')).toBe('https://example.com?lang=zh&q=hello%20world');
  });
});
