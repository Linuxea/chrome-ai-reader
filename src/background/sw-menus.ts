/**
 * F8 — context menu and keyboard shortcuts.
 *
 * Selection menu: explain / translate / ask about it / highlight.
 * Page menu: summarize / immersive translation.
 * Shortcuts (manifest `commands`): Alt+S opens the panel (_execute_action →
 * action.onClicked), Alt+Q asks about the current selection.
 *
 * Panel actions: the side panel may not be open yet, so the worker opens it
 * (sidePanel.open must run inside the user gesture — first thing in the
 * handler) and queues the action in storage.session; an open panel also gets
 * it directly via a `panelAction` message. The panel runs each action once
 * (features/panel-actions.ts).
 *
 * Menu titles are UI strings, but the worker cannot import i18n.js (it
 * touches `document`), so the few labels live here, keyed by language.
 */

import { readSettings } from '../platform/settings';
import { genId } from '../shared/ids';

export type PanelActionKind = 'explain' | 'translate' | 'summarize' | 'ask';

export interface PanelAction {
  id: string;
  kind: PanelActionKind;
  tabId: number;
  text: string;
  createdAt: number;
}

export const PENDING_ACTION_KEY = 'pendingPanelAction';

type MenuId = 'explain' | 'translate' | 'ask' | 'highlight' | 'summarize' | 'immersive';

const LABELS: Record<'zh' | 'en', Record<MenuId, string>> = {
  zh: {
    explain: '小🍐子：解释选中内容',
    translate: '小🍐子：翻译选中内容',
    ask: '小🍐子：就此提问',
    highlight: '小🍐子：高亮并保存到笔记',
    summarize: '小🍐子：总结这个页面',
    immersive: '小🍐子：沉浸式翻译此页（开/关）',
  },
  en: {
    explain: 'Xiao Pear: Explain selection',
    translate: 'Xiao Pear: Translate selection',
    ask: 'Xiao Pear: Ask about this',
    highlight: 'Xiao Pear: Highlight & save to notes',
    summarize: 'Xiao Pear: Summarize this page',
    immersive: 'Xiao Pear: Immersive translation (on/off)',
  },
};

const PREFIX = 'ai-reader-';

export async function setupContextMenus(): Promise<void> {
  if (!chrome.contextMenus) return;
  const { language } = await readSettings(['language']);
  const labels = LABELS[language === 'en' ? 'en' : 'zh'];
  await new Promise<void>((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  const selection: MenuId[] = ['explain', 'translate', 'ask', 'highlight'];
  const page: MenuId[] = ['summarize', 'immersive'];
  for (const id of selection) chrome.contextMenus.create({ id: PREFIX + id, title: labels[id], contexts: ['selection'] });
  for (const id of page) chrome.contextMenus.create({ id: PREFIX + id, title: labels[id], contexts: ['page'] });
}

/** Queue an action for the panel and notify an already-open panel. */
export async function queuePanelAction(kind: PanelActionKind, tabId: number, text: string): Promise<PanelAction> {
  const action: PanelAction = { id: genId(), kind, tabId, text, createdAt: Date.now() };
  await chrome.storage.session.set({ [PENDING_ACTION_KEY]: action });
  chrome.runtime.sendMessage({ action: 'panelAction', panelAction: action }).catch(() => { /* panel not open yet */ });
  return action;
}

export function onMenuClicked(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): void {
  const id = String(info.menuItemId);
  if (!id.startsWith(PREFIX) || tab?.id == null) return;
  const kind = id.slice(PREFIX.length) as MenuId;
  const tabId = tab.id;

  // Page-only actions: no panel needed.
  if (kind === 'highlight') { chrome.tabs.sendMessage(tabId, { action: 'highlightSelection', note: '' }).catch(() => {}); return; }
  if (kind === 'immersive') { chrome.tabs.sendMessage(tabId, { action: 'immersiveToggle' }).catch(() => {}); return; }

  // Must be first: sidePanel.open only works inside the user gesture.
  chrome.sidePanel.open({ tabId }).catch(() => {});
  void queuePanelAction(kind, tabId, kind === 'summarize' ? '' : (info.selectionText ?? ''));
}

export function onCommand(command: string, tab?: chrome.tabs.Tab): void {
  if (command !== 'ask-selection' || tab?.id == null) return;
  const tabId = tab.id;
  chrome.sidePanel.open({ tabId }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { action: 'getSelection' })
    .then((res: { text?: string } | undefined) => queuePanelAction('ask', tabId, res?.text ?? ''))
    .catch(() => queuePanelAction('ask', tabId, ''));
}
