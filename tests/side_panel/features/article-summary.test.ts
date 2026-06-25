import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key: string) => `[${key}]`,
  getCurrentLang: vi.fn(() => 'zh'),
}));

vi.mock('../../../src/shared/prompts.js', () => ({
  getPrompt: vi.fn((key: string) => `[prompt:${key}]`),
}));

vi.mock('../../../src/shared/constants.js', () => ({
  escapeHtml: (text: string) => text,
  safeTruncate: (text: string) => text,
  TRUNCATE_LIMITS: { CONTEXT: 64000 },
}));

vi.mock('../../../src/side_panel/state.js', () => ({
  getActiveTabId: vi.fn(() => 1),
  getStateForTab: vi.fn(),
  getPageContent: vi.fn(() => 'article body'),
  getPageTitle: vi.fn(() => 'Article Title'),
  getArticleSummary: vi.fn(() => ''),
  setArticleSummary: vi.fn(),
  getArticleSummaryStatus: vi.fn(() => 'idle'),
  setArticleSummaryStatus: vi.fn(),
  getArticleSummaryUrl: vi.fn(() => ''),
  setArticleSummaryUrl: vi.fn(),
  persistForTab: vi.fn(),
}));

vi.mock('../../../src/side_panel/events.js', () => ({
  on: vi.fn(),
  EVENTS: { PAGE_EXTRACTED: 'pageExtracted', REQUEST_RERENDER: 'requestRerender', TAB_CHANGED: 'tabChanged' },
}));

vi.mock('../../../src/platform/ports.js', () => ({
  openAIChatPort: vi.fn(),
}));

vi.mock('marked', () => ({
  marked: { parse: vi.fn((s: string) => `<p>${s}</p>`) },
}));

import { initArticleSummary, renderArticleSummary, requestArticleSummary, __internals } from '../../../src/side_panel/features/article-summary.js';
import * as stateMock from '../../../src/side_panel/state.js';
import * as eventsMock from '../../../src/side_panel/events.js';
import * as portsMock from '../../../src/platform/ports.js';
import { getPrompt } from '../../../src/shared/prompts.js';

function mockPort() {
  const listeners = { message: null as ((msg: unknown) => void) | null, disconnect: null as (() => void) | null };
  return {
    onMessage: { addListener: vi.fn((fn: (msg: unknown) => void) => { listeners.message = fn; }) },
    onDisconnect: { addListener: vi.fn((fn: () => void) => { listeners.disconnect = fn; }) },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    _listeners: listeners,
  };
}

describe('features/article-summary', () => {
  let chatArea: HTMLElement;
  let tabState: {
    articleSummary: string;
    articleSummaryStatus: 'idle' | 'generating' | 'done' | 'error';
    articleSummaryUrl: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);
    tabState = { articleSummary: '', articleSummaryStatus: 'idle', articleSummaryUrl: '' };
    stateMock.getStateForTab.mockReturnValue(tabState);
  });

  it('renders a distinct summary card, not a normal chat message', () => {
    initArticleSummary({ chatArea });
    renderArticleSummary('Brief **text**');

    const card = chatArea.querySelector('.article-summary-card');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('message')).toBe(false);
    expect(card?.classList.contains('message-ai')).toBe(false);
    expect(card?.textContent).toContain('[summary.title]');
    expect(card?.innerHTML).toContain('<p>Brief **text**</p>');
  });

  it('reuses one card when rendering updates', () => {
    initArticleSummary({ chatArea });
    renderArticleSummary('First');
    renderArticleSummary('Second');

    expect(chatArea.querySelectorAll('.article-summary-card')).toHaveLength(1);
    expect(chatArea.querySelector('.article-summary-card')?.textContent).toContain('Second');
  });

  it('requests a summary through the ai-chat port and stores streamed text on done', async () => {
    initArticleSummary({ chatArea });
    const port = mockPort();
    portsMock.openAIChatPort.mockReturnValue(port);

    await requestArticleSummary({ tabId: 1, url: 'https://example.com/article', title: 'Article Title', content: 'article body' });
    expect(stateMock.setArticleSummaryStatus).toHaveBeenCalledWith('generating');
    expect(stateMock.setArticleSummaryUrl).toHaveBeenCalledWith('https://example.com/article');
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'chat',
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: '[prompt:default]' }),
        expect.objectContaining({ role: 'system', content: '[prompt:default.article]' }),
        expect.objectContaining({ role: 'user', content: '[prompt:summary.card]' }),
      ]),
    });
    expect(getPrompt).toHaveBeenCalledWith('summary.card', 'zh');

    port._listeners.message?.({ type: 'chunk', content: 'A' });
    port._listeners.message?.({ type: 'chunk', content: 'B' });
    port._listeners.message?.({ type: 'done' });

    expect(stateMock.setArticleSummary).toHaveBeenCalledWith('AB');
    expect(stateMock.setArticleSummaryStatus).toHaveBeenCalledWith('done');
    expect(tabState.articleSummary).toBe('AB');
    expect(chatArea.querySelector('.article-summary-card')?.textContent).toContain('AB');
  });

  it('does not mutate conversation history while generating the card', async () => {
    initArticleSummary({ chatArea });
    const port = mockPort();
    portsMock.openAIChatPort.mockReturnValue(port);
    const stateWithHistory = { ...tabState, conversationHistory: [{ role: 'user', content: 'keep' }] };
    stateMock.getStateForTab.mockReturnValue(stateWithHistory);

    await requestArticleSummary({ tabId: 1, url: 'https://example.com/article', title: 'Article Title', content: 'article body' });
    port._listeners.message?.({ type: 'chunk', content: 'Brief' });
    port._listeners.message?.({ type: 'done' });

    expect(stateWithHistory.conversationHistory).toEqual([{ role: 'user', content: 'keep' }]);
  });

  it('subscribes to page extraction and starts auto summary with extracted content', () => {
    initArticleSummary({ chatArea });
    const handler = eventsMock.on.mock.calls.find(([event]) => event === 'pageExtracted')?.[1];
    expect(handler).toBeTypeOf('function');

    handler?.({ tabId: 1, url: 'https://example.com/article', title: 'Article Title', content: 'article body' });

    expect(__internals.pendingRequest()).toEqual({ tabId: 1, url: 'https://example.com/article', title: 'Article Title', content: 'article body' });
  });
});
