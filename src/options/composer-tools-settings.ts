/**
 * Input-bar tools (F-composer): which attachment actions sit directly in
 * the composer and which fold into the "+" overflow menu. Saved IMMEDIATELY
 * on change (like quick commands) — the panel applies it live via
 * onSettingsChange, no save-button round trip.
 */
import { COMPOSER_TOOL_IDS, type ComposerToolId } from '../platform/settings';

const CHECKBOXES: Record<ComposerToolId, HTMLInputElement> = {
  capture: document.getElementById('composerToolCapture') as HTMLInputElement,
  captureFull: document.getElementById('composerToolCaptureFull') as HTMLInputElement,
  upload: document.getElementById('composerToolUpload') as HTMLInputElement,
  tabs: document.getElementById('composerToolTabs') as HTMLInputElement,
};

export function initComposerToolsSettings(): void {
  for (const id of COMPOSER_TOOL_IDS) {
    CHECKBOXES[id].addEventListener('change', () => { void save(); });
  }
}

function save(): Promise<void> {
  const shown = COMPOSER_TOOL_IDS.filter(id => CHECKBOXES[id].checked);
  // All tools unchecked is a valid state (everything in the "+" menu) —
  // the panel guards against a missing/empty array with the full default.
  return chrome.storage.sync.set({ composerTools: shown });
}

export function loadComposerToolValues(data: Record<string, unknown>): void {
  const stored = Array.isArray(data.composerTools) ? (data.composerTools as string[]) : null;
  for (const id of COMPOSER_TOOL_IDS) {
    CHECKBOXES[id].checked = stored ? stored.includes(id) : true; // absent → all shown (default)
  }
}
