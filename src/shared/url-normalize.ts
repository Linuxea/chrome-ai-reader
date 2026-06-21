/**
 * URL normalization for the "related pages" feature.
 *
 * Why this exists: the same page can be visited under different URL variants
 * (with tracking params, hash anchors, param-order differences). Without
 * normalization, `findRelatedPages` would (a) store the same page multiple
 * times and (b) fail to find the current page's own embedding when the URL
 * differs even slightly from the stored one — producing an empty panel.
 *
 * Strategy:
 *   1. Strip hash (#...)
 *   2. Strip tracking/marketing params: utm_*, ref, ref_src, source, from,
 *      gclid, fbclid, spm, share_*, mc_cid, mc_eid
 *   3. Sort remaining params by key (so order doesn't matter)
 *   4. Lowercase host
 *   5. Strip trailing slash from path (except root "/")
 *
 * Best-effort: invalid URLs are returned as-is (lowercased) so callers don't
 * crash. The feature treats normalizeUrl as a pure string→string transform.
 */

/** Tracking/marketing query params that should not affect page identity. */
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i, // utm_source, utm_medium, utm_campaign, ...
  /^share_/i, // share_id, share_token, ...
  // exact-match params (lowercased before comparison)
];

const TRACKING_PARAM_EXACT = new Set([
  'ref',
  'ref_src',
  'source',
  'from',
  'gclid',
  'fbclid',
  'spm',
  'mc_cid',
  'mc_eid',
  'igshid',
  'si', // YouTube share
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAM_EXACT.has(lower)) return true;
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(key));
}

/**
 * Normalize a URL for storage/matching in the related-pages feature.
 * Returns the original string (lowercased) if parsing fails — never throws.
 */
export function normalizeUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.toLowerCase();
  }

  // Lowercase host
  parsed.hostname = parsed.hostname.toLowerCase();

  // Drop tracking params, keep the rest
  const kept: [string, string][] = [];
  parsed.searchParams.forEach((value, key) => {
    if (!isTrackingParam(key)) kept.push([key, value]);
  });

  // Re-sort for stable ordering
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // Rebuild search string
  const search = kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  // Drop hash
  // Normalize path: empty for root (so 'https://x.com' === 'https://x.com/'),
  // otherwise strip trailing slash.
  let path = parsed.pathname;
  if (path === '/' || path === '') {
    path = '';
  } else if (path.length > 1 && path.endsWith('/')) {
    path = path.replace(/\/+$/, '');
  }

  let out = `${parsed.protocol}//${parsed.host}${path}`;
  if (search) out += `?${search}`;
  return out;
}
