/**
 * F8 — run actions that arrive from the context menu / shortcuts
 * (background/sw-menus.ts). Each action is queued in storage.session (the
 * panel may be opening just now) and also messaged to an already-open panel;
 * `_done` makes sure it runs once either way. Actions older than
 * ACTION_TTL_MS, or for another tab, are ignored.
 */

import * as state from '../state';
import { updateQuotePreview, type QuotePreviewEls } from '../ui/quote-preview';
import { handleQuickAction } from '../services/quick-action-handler';

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
let _els: QuotePreviewEls;
let _userInput: HTMLTextAreaElement | null = null;

export function initPanelActions({ quoteEls, userInput }: { quoteEls: QuotePreviewEls; userInput: HTMLTextAreaElement }): void {
  _els = quoteEls;
  _userInput = userInput;
  chrome.runtime.onMessage.addListener((msg: { action?: string; panelAction?: PanelAction }) => {
    if (msg?.action === 'panelAction' && msg.panelAction) void runPanelAction(msg.panelAction);
  });
  void chrome.storage.session.get(PENDING_ACTION_KEY).then((data) => {
    const pending = data[PENDING_ACTION_KEY] as PanelAction | undefined;
    if (pending) void runPanelAction(pending);
  });
}

export async function runPanelAction(action: PanelAction): Promise<boolean> {
  if (_done.has(action.id)) return false;
  if (Date.now() - action.createdAt > ACTION_TTL_MS) return false;
  if (action.tabId !== state.getActiveTabId()) return false;
  _done.add(action.id);
  void chrome.storage.session.remove(PENDING_ACTION_KEY);

  if (action.text) updateQuotePreview(_els, action.text);
  if (action.kind === 'ask') {
    _userInput?.focus();
    return true;
  }
  await handleQuickAction(action.kind);
  return true;
}
