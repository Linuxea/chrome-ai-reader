import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock global-events so we can assert the follow-up reuses updateQuotePreview.
// vi.hoisted ensures the mock fn exists before vi.mock's factory runs (vi.mock
// is hoisted above imports).
const { updateQuotePreview } = vi.hoisted(() => ({ updateQuotePreview: vi.fn() }));
vi.mock('../../../src/side_panel/ui/quote-preview.js', () => ({
  updateQuotePreview,
}));

// The panel's active tab + a real subscribe so tab switches can be simulated.
const { activeTab, stateListeners } = vi.hoisted(() => ({
  activeTab: { id: 42 as number | null },
  stateListeners: new Map<string, Set<(v: unknown) => void>>(),
}));
vi.mock('../../../src/side_panel/state.js', () => ({
  getActiveTabId: () => activeTab.id,
  subscribe: (key: string, cb: (v: unknown) => void) => {
    if (!stateListeners.has(key)) stateListeners.set(key, new Set());
    stateListeners.get(key)!.add(cb);
    return () => stateListeners.get(key)?.delete(cb);
  },
}));

// chrome mock
type Sender = { tab?: { id?: number } };
let runtimeListeners: ((msg: Record<string, unknown>, sender: Sender) => void)[] = [];
let updatedListeners: ((tabId: number, info: { status?: string }) => void)[] = [];
const tabsSendMessage = vi.fn(() => Promise.resolve({ ok: true }));
const executeScript = vi.fn(() => Promise.resolve());
vi.stubGlobal('chrome', {
  tabs: {
    sendMessage: tabsSendMessage,
    onUpdated: { addListener: (cb: (tabId: number, info: { status?: string }) => void) => updatedListeners.push(cb) },
    onRemoved: { addListener: vi.fn() },
  },
  scripting: { executeScript },
  runtime: {
    onMessage: { addListener: (cb: (m: Record<string, unknown>, s: Sender) => void) => runtimeListeners.push(cb) },
  },
});

import { initAnnotation, __getAnnotationState } from '../../../src/side_panel/features/annotation.js';
import { initComposer } from '../../../src/side_panel/services/composer.js';

/** A message from the content script of `tabId` (defaults to the active tab 42). */
function fireRuntime(msg: Record<string, unknown>, tabId = 42): void {
  for (const cb of runtimeListeners) cb(msg, { tab: { id: tabId } });
}

function switchTo(tabId: number): void {
  activeTab.id = tabId;
  stateListeners.get('tabSwitched')?.forEach(cb => cb(undefined));
}

describe('side_panel/features/annotation', () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="annotationBtn" class="action-btn"><span class="action-icon">🩺</span><span data-i18n="annotation.button">深度批阅</span></button>`;
    runtimeListeners = [];
    updatedListeners = [];
    stateListeners.clear();
    activeTab.id = 42;
    tabsSendMessage.mockReset();
    tabsSendMessage.mockResolvedValue({ ok: true });
    executeScript.mockClear();
  });

  it('sends startAnnotation to the active tab on button click', async () => {
    initAnnotation({ button: document.getElementById('annotationBtn') as HTMLButtonElement });
    document.getElementById('annotationBtn')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(tabsSendMessage).toHaveBeenCalledWith(42, { action: 'startAnnotation' });
  });

  it('updates button label to progress on annotationProgress', () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationProgress', done: 3, total: 8 });
    expect(btn.textContent).toContain('3');
    expect(btn.textContent).toContain('8');
    expect(__getAnnotationState()).toBe('annotating');
  });

  it('updates button label and state on annotationDone', () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationDone', count: 12 });
    expect(btn.textContent).toContain('12');
    expect(__getAnnotationState()).toBe('done');
  });

  it('clears annotations (clearAnnotation) on a second click when done', async () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationDone', count: 5 });
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tabsSendMessage).toHaveBeenCalledWith(42, { action: 'clearAnnotation' });
    expect(__getAnnotationState()).toBe('idle');
  });

  it('disables the button and shows error state on annotationFailed', () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationProgress', done: 0, total: 4 });
    fireRuntime({ action: 'annotationFailed', chunkIndex: 0 });
    expect(__getAnnotationState()).toBe('error');
  });

  it('surfaces the real error on annotationFailed (button title + console.error)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationFailed', error: 'json_object is not supported by this model' });
    expect(__getAnnotationState()).toBe('error');
    expect(btn.title).toContain('json_object is not supported');
    expect(consoleSpy).toHaveBeenCalledWith('[annotation] failed:', 'json_object is not supported by this model');
    consoleSpy.mockRestore();
  });

  it('shows partial-failure info on annotationDone with failed > 0 (title + console.warn)', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationDone', count: 5, failed: 2 });
    expect(__getAnnotationState()).toBe('done');
    expect(btn.title).toContain('2');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('on annotationFollowUp: shows the source quote via updateQuotePreview and fills the comment into the input', () => {
    updateQuotePreview.mockClear();
    const input = document.createElement('textarea');
    input.id = 'userInput';
    document.body.appendChild(input);
    initComposer({ userInput: input });
    const quoteText = document.createElement('span');
    quoteText.id = 'quoteText';
    const quotePreview = document.createElement('div');
    quotePreview.id = 'quotePreview';
    document.body.append(quoteText, quotePreview);

    initAnnotation({
      button: document.getElementById('annotationBtn') as HTMLButtonElement,
      userInput: input,
      quoteText,
      quotePreview,
    });

    fireRuntime({
      action: 'annotationFollowUp',
      quote: '90% 以上代码由 AI 辅助编写',
      comment: '这里的水分在于基线未说明',
    });

    // The annotated SOURCE sentence is shown as the quote preview (same UI as
    // the normal quote feature), so the next send attaches it as context.
    expect(updateQuotePreview).toHaveBeenCalledTimes(1);
    const [elsArg, textArg] = updateQuotePreview.mock.calls[0];
    expect(elsArg.quotePreview).toBe(quotePreview);
    expect(textArg).toBe('90% 以上代码由 AI 辅助编写');
    // The AI COMMENT goes into the input for follow-up.
    expect(input.value).toContain('这里的水分在于基线未说明');
  });

  describe('per-tab state', () => {
    it('shows each tab its own annotation state', () => {
      const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
      initAnnotation({ button: btn });
      fireRuntime({ action: 'annotationDone', count: 7 }, 42);

      switchTo(99);
      expect(__getAnnotationState()).toBe('idle');
      expect(btn.textContent).not.toContain('7');

      switchTo(42);
      expect(__getAnnotationState()).toBe('done');
      expect(btn.textContent).toContain('7');
    });

    it('progress from a background tab does not change the visible button', () => {
      const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
      initAnnotation({ button: btn });
      fireRuntime({ action: 'annotationProgress', done: 1, total: 5 }, 99);
      expect(__getAnnotationState()).toBe('idle');
    });

    it('ignores follow-ups from a background tab', () => {
      const input = document.createElement('textarea');
      document.body.appendChild(input);
      initComposer({ userInput: input });
      initAnnotation({ button: document.getElementById('annotationBtn') as HTMLButtonElement, userInput: input });
      fireRuntime({ action: 'annotationFollowUp', quote: 'q', comment: 'from another tab' }, 99);
      expect(input.value).toBe('');
    });

    it('a page reload returns that tab to idle', () => {
      initAnnotation({ button: document.getElementById('annotationBtn') as HTMLButtonElement });
      fireRuntime({ action: 'annotationDone', count: 3 }, 42);
      updatedListeners.forEach(cb => cb(42, { status: 'loading' }));
      expect(__getAnnotationState()).toBe('idle');
    });

    it('shows an error instead of hanging when the page cannot host the content script', async () => {
      tabsSendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      executeScript.mockRejectedValueOnce(new Error('Cannot access a chrome:// URL'));
      const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
      initAnnotation({ button: btn });

      btn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(__getAnnotationState()).toBe('error');
      expect(btn.title).toContain('无法读取这个页面');
    });
  });
});
