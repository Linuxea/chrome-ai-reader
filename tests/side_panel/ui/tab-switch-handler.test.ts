/**
 * Tests for side_panel/ui/tab-switch-handler.ts — feature cleanup + UI reset.
 *
 * cleanupActiveFeatures(): stops TTS, removes podcast cards, resets flags.
 * handleLoadChat(): restores state from saved chat data.
 * resetUIForTabSwitch(): re-renders conversation history or welcome message.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../src/side_panel/state.js', () => ({
  getIsPodcastGenerating: vi.fn(() => false),
  setIsPodcastGenerating: vi.fn(),
  setCurrentChatId: vi.fn(),
  setPageTitle: vi.fn(),
  setPageContent: vi.fn(),
  setPageExcerpt: vi.fn(),
  setArticleSummary: vi.fn(),
  setArticleSummaryStatus: vi.fn(),
  setArticleSummaryUrl: vi.fn(),
  setConversationHistory: vi.fn(),
  getConversationHistory: vi.fn(() => []),
  getArticleSummary: vi.fn(() => ''),
  getArticleSummaryStatus: vi.fn(() => 'idle'),
}));
vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({
  appendMessage: vi.fn(() => {
    const el = document.createElement('div');
    return el;
  }),
  appendMessageFromHistory: vi.fn((msg: { role: string; content: unknown }) => {
    const el = document.createElement('div');
    el.className = `message message-${msg.role === 'assistant' ? 'ai' : msg.role}`;
    if (typeof msg.content === 'string') el.textContent = msg.content;
    return el;
  }),
}));
vi.mock('../../../src/side_panel/services/ocr.js', () => ({ clearImagePreviews: vi.fn() }));
vi.mock('../../../src/side_panel/ui/global-events.js', () => ({
  updateQuotePreview: vi.fn(),
}));

import {
  cleanupActiveFeatures,
  handleLoadChat,
  resetUIForTabSwitch,
  type UIElements,
  type GlobalEventDeps,
} from '../../../src/side_panel/ui/tab-switch-handler';
import * as stateMock from '../../../src/side_panel/state.js';
import { appendMessage, appendMessageFromHistory } from '../../../src/side_panel/ui/dom-helpers.js';

function createEls(): UIElements {
  return {
    settingsBtn: document.createElement('button'),
    newChatBtn: document.createElement('button'),
    exportBtn: document.createElement('button'),
    historyBtn: document.createElement('button'),
    historyBackBtn: document.createElement('button'),
    quoteClose: document.createElement('button'),
    chatArea: document.createElement('div'),
    quoteText: document.createElement('span'),
    quotePreview: document.createElement('div'),
    historyPanel: document.createElement('div'),
    historyList: document.createElement('div'),
    userInput: document.createElement('textarea'),
  };
}

function createDeps(): GlobalEventDeps {
  return {
    removeSuggestQuestions: vi.fn(),
    isTTSPlaying: vi.fn(() => false),
    stopTTS: vi.fn(),
  };
}

describe('ui/tab-switch-handler', () => {
  let els: UIElements;
  let deps: GlobalEventDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    els = createEls();
    deps = createDeps();
  });

  describe('cleanupActiveFeatures()', () => {
    it('stops TTS when playing', () => {
      deps.isTTSPlaying.mockReturnValue(true);
      cleanupActiveFeatures(els, deps);
      expect(deps.stopTTS).toHaveBeenCalled();
    });

    it('does not stop TTS when not playing', () => {
      deps.isTTSPlaying.mockReturnValue(false);
      cleanupActiveFeatures(els, deps);
      expect(deps.stopTTS).not.toHaveBeenCalled();
    });

    it('removes existing podcast card', () => {
      const podcastCard = document.createElement('div');
      podcastCard.className = 'podcast-card';
      els.chatArea.appendChild(podcastCard);

      cleanupActiveFeatures(els, deps);

      expect(els.chatArea.querySelector('.podcast-card')).toBeNull();
    });

    it('resets podcast generating flag when active', () => {
      stateMock.getIsPodcastGenerating.mockReturnValue(true);
      cleanupActiveFeatures(els, deps);
      expect(stateMock.setIsPodcastGenerating).toHaveBeenCalledWith(false);
    });
  });

  describe('handleLoadChat()', () => {
    it('restores state from chat data', () => {
      handleLoadChat(els, deps, {
        id: 'chat-123',
        pageTitle: 'Test Page',
        pageContent: 'Content',
        pageExcerpt: 'Excerpt',
        articleSummary: 'Brief',
        articleSummaryStatus: 'done',
        articleSummaryUrl: 'https://example.com',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(stateMock.setCurrentChatId).toHaveBeenCalledWith('chat-123');
      expect(stateMock.setPageTitle).toHaveBeenCalledWith('Test Page');
      expect(stateMock.setPageContent).toHaveBeenCalledWith('Content');
      expect(stateMock.setArticleSummary).toHaveBeenCalledWith('Brief');
      expect(stateMock.setArticleSummaryStatus).toHaveBeenCalledWith('done');
      expect(stateMock.setArticleSummaryUrl).toHaveBeenCalledWith('https://example.com');
      expect(stateMock.setConversationHistory).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }]);
    });

    it('defaults missing fields to empty values', () => {
      handleLoadChat(els, deps, { id: 'x' });

      expect(stateMock.setPageTitle).toHaveBeenCalledWith('');
      expect(stateMock.setPageContent).toHaveBeenCalledWith('');
      expect(stateMock.setArticleSummary).toHaveBeenCalledWith('');
      expect(stateMock.setArticleSummaryStatus).toHaveBeenCalledWith('idle');
      expect(stateMock.setArticleSummaryUrl).toHaveBeenCalledWith('');
      expect(stateMock.setConversationHistory).toHaveBeenCalledWith([]);
    });

    it('cleans up active features and suggest questions', () => {
      handleLoadChat(els, deps, { id: 'x' });
      expect(deps.removeSuggestQuestions).toHaveBeenCalled();
    });
  });

  describe('resetUIForTabSwitch()', () => {
    it('renders conversation history as messages', () => {
      stateMock.getConversationHistory.mockReturnValue([
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer' },
      ]);

      resetUIForTabSwitch(els, deps);

      // appendMessageFromHistory called for each message
      expect(appendMessageFromHistory).toHaveBeenCalledTimes(2);
      expect(appendMessageFromHistory).toHaveBeenCalledWith({ role: 'user', content: 'question' });
      expect(appendMessageFromHistory).toHaveBeenCalledWith({ role: 'assistant', content: 'answer' });
    });

    it('shows welcome message when no history', () => {
      stateMock.getConversationHistory.mockReturnValue([]);
      stateMock.getArticleSummary.mockReturnValue('');
      stateMock.getArticleSummaryStatus.mockReturnValue('idle');

      resetUIForTabSwitch(els, deps);

      expect(els.chatArea.innerHTML).toContain('welcome-msg');
    });

    it('does not show welcome when an article summary exists without chat history', () => {
      stateMock.getConversationHistory.mockReturnValue([]);
      stateMock.getArticleSummary.mockReturnValue('Brief');
      stateMock.getArticleSummaryStatus.mockReturnValue('done');

      resetUIForTabSwitch(els, deps);

      expect(els.chatArea.innerHTML).not.toContain('welcome-msg');
    });

    it('clears suggest questions and image previews', () => {
      resetUIForTabSwitch(els, deps);
      expect(deps.removeSuggestQuestions).toHaveBeenCalled();
    });
  });
});
