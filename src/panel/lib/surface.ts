/**
 * F17: which surface this page renders — the side panel (a page-grounded
 * reading assistant) or the fullscreen tab (a PURE chat). Marked by
 * RENDERING FullscreenApp (idempotent, so the fullscreen surface can never
 * render unflagged); read by the send pipeline and surface layouts.
 *
 * The fullscreen surface never reads the TabState's page cache: no
 * extraction, no article system message, no citation rule. The cache still
 * lives in the (synced) state — the side panel depends on it — this surface
 * just doesn't ground its requests on it.
 */
let _fullscreen = false;

/** Called from FullscreenApp's render — rendering it IS the mark. */
export function markFullscreenSurface(): void {
  _fullscreen = true;
}

/** Test hook — restore the default (side panel) surface between tests. */
export function resetSurfaceMode(): void {
  _fullscreen = false;
}

export function isFullscreenSurface(): boolean {
  return _fullscreen;
}
