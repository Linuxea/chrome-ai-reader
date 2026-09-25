import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/side_panel/state.js', () => ({ getActiveTabId: () => 4, setSelectedText: vi.fn() }));
vi.mock('../../../src/side_panel/services/quick-action-handler.js', () => ({ handleQuickAction: vi.fn() }));

import { initPanelActions, runPanelAction, ACTION_TTL_MS } from '../../../src/side_panel/features/panel-actions';
import { handleQuickAction } from '../../../src/side_panel/services/quick-action-handler.js';

let onMessage: ((m: unknown) => void) | null = null;
const session: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="qp" class="hidden"><span id="qt"></span></div><textarea id="in"></textarea>';
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (f: (m: unknown) => void) => { onMessage = f; } } },
    storage: { session: {
      get: vi.fn(async (k: string) => (session[k] ? { [k]: session[k] } : {})),
      remove: vi.fn(async (k: string) => { delete session[k]; }),
    } },
  });
});

const els = () => ({
  quoteEls: { quoteText: document.getElementById('qt')!, quotePreview: document.getElementById('qp')! },
  userInput: document.getElementById('in') as HTMLTextAreaElement,
});
const action = (over: Record<string, unknown> = {}) =>
  ({ id: Math.random().toString(36), kind: 'explain', tabId: 4, text: 'selected words', createdAt: Date.now(), ...over });

describe('features/panel-actions', () => {
  it('runs a queued action once on open: quote set, quick action fired', async () => {
    const a = action();
    session.pendingPanelAction = a;
    initPanelActions(els());
    await vi.waitFor(() => expect(handleQuickAction).toHaveBeenCalledWith('explain'));
    expect(document.getElementById('qt')!.textContent).toBe('selected words');
    onMessage!({ action: 'panelAction', panelAction: a }); // duplicate delivery
    expect(handleQuickAction).toHaveBeenCalledTimes(1);
  });

  it('ignores stale actions and actions for another tab', async () => {
    initPanelActions(els());
    expect(await runPanelAction(action({ createdAt: Date.now() - ACTION_TTL_MS - 1 }))).toBe(false);
    expect(await runPanelAction(action({ tabId: 99 }))).toBe(false);
    expect(handleQuickAction).not.toHaveBeenCalled();
  });

  it('"ask" only sets the quote and focuses the input', async () => {
    initPanelActions(els());
    expect(await runPanelAction(action({ kind: 'ask' }))).toBe(true);
    expect(handleQuickAction).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('in');
  });
});
