import { vi, describe, it, expect, beforeEach } from 'vitest';

// chrome mock
let runtimeListeners: ((msg: Record<string, unknown>) => void)[] = [];
const tabsQuery = vi.fn();
const tabsSendMessage = vi.fn();
vi.stubGlobal('chrome', {
  tabs: { query: tabsQuery, sendMessage: tabsSendMessage },
  runtime: {
    onMessage: { addListener: (cb: (m: Record<string, unknown>) => void) => runtimeListeners.push(cb) },
  },
});

import { initAnnotation, __getAnnotationState } from '../../../src/side_panel/features/annotation.js';

function fireRuntime(msg: Record<string, unknown>): void {
  for (const cb of runtimeListeners) cb(msg);
}

describe('side_panel/features/annotation', () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="annotationBtn" class="action-btn"><span class="action-icon">🩺</span><span data-i18n="annotation.button">深度批阅</span></button>`;
    runtimeListeners = [];
    tabsQuery.mockClear();
    tabsSendMessage.mockClear();
    tabsQuery.mockResolvedValue([{ id: 42 }]);
  });

  it('sends startAnnotation to the active tab on button click', async () => {
    initAnnotation({ button: document.getElementById('annotationBtn') as HTMLButtonElement });
    document.getElementById('annotationBtn')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(tabsSendMessage).toHaveBeenCalledWith(42, { action: 'startAnnotation' }, expect.any(Function));
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
    expect(tabsSendMessage).toHaveBeenCalledWith(42, { action: 'clearAnnotation' }, expect.any(Function));
    expect(__getAnnotationState()).toBe('idle');
  });

  it('disables the button and shows error state on annotationFailed', () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationProgress', done: 0, total: 4 });
    fireRuntime({ action: 'annotationFailed', chunkIndex: 0 });
    expect(__getAnnotationState()).toBe('error');
  });

  it('fills the input with the comment on annotationFollowUp', () => {
    const input = document.createElement('textarea');
    input.id = 'userInput';
    document.body.appendChild(input);
    initAnnotation({
      button: document.getElementById('annotationBtn') as HTMLButtonElement,
      userInput: input,
    });
    fireRuntime({ action: 'annotationFollowUp', text: 'follow up on this' });
    expect(input.value).toContain('follow up on this');
  });
});
