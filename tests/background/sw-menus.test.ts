import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/platform/settings', () => ({ readSettings: vi.fn(async () => ({ language: 'en' })) }));

import { setupContextMenus, onMenuClicked, onCommand, PENDING_ACTION_KEY } from '../../src/background/sw-menus';

const created: { id: string; title: string; contexts: string[] }[] = [];
const session: Record<string, unknown> = {};

beforeEach(() => {
  created.length = 0;
  for (const k of Object.keys(session)) delete session[k];
  vi.stubGlobal('chrome', {
    contextMenus: { removeAll: (cb: () => void) => cb(), create: (item: never) => created.push(item) },
    sidePanel: { open: vi.fn(() => Promise.resolve()) },
    tabs: { sendMessage: vi.fn(() => Promise.resolve({ text: 'sel' })) },
    runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
    storage: { session: { set: vi.fn(async (o: Record<string, unknown>) => Object.assign(session, o)) } },
  });
});

describe('background/sw-menus', () => {
  it('creates selection and page menu items in the UI language', async () => {
    await setupContextMenus();
    expect(created.map((c) => c.id)).toEqual([
      'ai-reader-explain', 'ai-reader-translate', 'ai-reader-ask', 'ai-reader-highlight', 'ai-reader-summarize', 'ai-reader-immersive',
    ]);
    expect(created[0].title).toMatch(/^Xiao Pear: Explain/);
    expect(created[4].contexts).toEqual(['page']);
  });

  it('explain: opens the panel in the gesture and queues the action with the selection', async () => {
    onMenuClicked({ menuItemId: 'ai-reader-explain', selectionText: 'words' } as chrome.contextMenus.OnClickData, { id: 8 } as chrome.tabs.Tab);
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 8 });
    await vi.waitFor(() => expect(session[PENDING_ACTION_KEY]).toMatchObject({ kind: 'explain', tabId: 8, text: 'words' }));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'panelAction' }));
  });

  it('highlight and immersive go straight to the page', () => {
    onMenuClicked({ menuItemId: 'ai-reader-highlight' } as chrome.contextMenus.OnClickData, { id: 8 } as chrome.tabs.Tab);
    onMenuClicked({ menuItemId: 'ai-reader-immersive' } as chrome.contextMenus.OnClickData, { id: 8 } as chrome.tabs.Tab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(8, { action: 'highlightSelection', note: '' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(8, { action: 'immersiveToggle' });
    expect(chrome.sidePanel.open).not.toHaveBeenCalled();
  });

  it('Alt+Q reads the page selection and queues an ask', async () => {
    onCommand('ask-selection', { id: 3 } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(session[PENDING_ACTION_KEY]).toMatchObject({ kind: 'ask', tabId: 3, text: 'sel' }));
  });
});
