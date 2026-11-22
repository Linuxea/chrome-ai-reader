/**
 * F8 — run actions that arrive from the context menu / shortcuts
 * (background/sw-menus.ts). Each action is queued in storage.session (the
 * panel may be opening just now) and also messaged to an already-open panel;
 * `_done` makes sure it runs once either way. Actions older than
 * ACTION_TTL_MS, or for another tab, are ignored. React port: the quote
 * goes through tabs-store's selectedText, "ask" focuses the composer.
 */
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { handleQuickAction } from './quick-action-handler';

export const PENDING_ACTION_KEY = 'pendingPanelAction';
export const ACTION_TTL_MS = 30_000;

export interface PanelAction {
  id: string;
  kind: 'explain' | 'translate' | 'summarize' | 'ask';
  tabId: number;
  text: string;
  createdAt: number;
}

const _done = new Set<string>();
let _askFocus: (() => void) | null = null;

/** Register the composer focus hook (App wires it once the UI exists). */
export function setAskFocusHook(fn: (() => void) | null): void {
  _askFocus = fn;
}

let _initialized = false;

export function initPanelActions(): void {
  if (_initialized) return;
  _initialized = true;
  chrome.runtime.onMessage.addListener((msg: { action?: string; panelAction?: PanelAction }) => {
    if (msg?.action === 'panelAction' && msg.panelAction) void runPanelAction(msg.panelAction);
  });
  void chrome.storage.session.get(PENDING_ACTION_KEY).then(data => {
    const pending = data[PENDING_ACTION_KEY] as PanelAction | undefined;
    if (pending) void runPanelAction(pending);
  });
}

export async function runPanelAction(action: PanelAction): Promise<boolean> {
  if (_done.has(action.id)) return false;
  if (Date.now() - action.createdAt > ACTION_TTL_MS) return false;
  if (action.tabId !== core.getActiveTabId()) return false;
  _done.add(action.id);
  void chrome.storage.session.remove(PENDING_ACTION_KEY);

  if (action.text) useTabsStore.getState().setSelectedText(action.text);
  if (action.kind === 'ask') {
    useComposerStore.getState(); // ensure store exists
    _askFocus?.();
    return true;
  }
  await handleQuickAction(action.kind);
  return true;
}
