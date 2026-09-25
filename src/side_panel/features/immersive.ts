/**
 * F7 — the panel's "immersive translation" button: toggles bilingual
 * translation in the page (content/immersive.ts) and reports failures.
 */

import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { sendToContentScript } from '../../platform/messaging';
import { showToast } from '../ui/toast';

export function initImmersive({ button }: { button: HTMLElement | null }): void {
  if (!button) return;
  button.addEventListener('click', () => { void toggle(button); });
  chrome.runtime.onMessage.addListener((msg: { action?: string; error?: string }) => {
    if (msg?.action !== 'immersiveDone') return;
    if (msg.error) showToast(msg.error.startsWith('error.') ? t(msg.error) : t('immersive.failed', { error: msg.error }), 3500);
  });
  // The toggle state belongs to the page shown: reset it on tab switch.
  state.subscribe('tabSwitched', () => button.classList.remove('active'));
}

export async function toggle(button: HTMLElement): Promise<void> {
  const tabId = state.getActiveTabId();
  if (tabId == null) return;
  try {
    const res = await sendToContentScript<{ active?: boolean }>(tabId, { action: 'immersiveToggle' });
    button.classList.toggle('active', res?.active === true);
    if (res?.active) showToast(t('immersive.started'), 2000);
  } catch {
    showToast(t('error.pageUnsupported'), 2500);
  }
}
