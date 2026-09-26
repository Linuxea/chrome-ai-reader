/**
 * Tests for side_panel/shell/tab-switch-handler.ts — feature cleanup + UI reset.
 *
 * cleanupActiveFeatures(): detaches the window-global TTS anchor (audio keeps
 * playing across tabs), removes podcast cards, resets flags.
 * handleLoadChat(): restores state from saved chat data.
 * resetUIForTabSwitch(): re-renders conversation history or welcome message.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../src/side_panel/state.js', () => ({
  getActiveTabId: vi.fn(() => 1),
  getStateForTab: vi.fn(() => ({ conversationHistory: [], branches: {} })),
  getIsPodcastGenerating: vi.fn(() => false),
  setIsPodcastGenerating: vi.fn(),
  setCurrentChatId: vi.fn(),
  setPageTitle: vi.fn(),
  setPageContent: vi.fn(),
  setPageExcerpt: vi.fn(),
  setConversationHistory: vi.fn(),
  getConversationHistory: vi.fn(() => []),
}));
vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({
  scrollToBottom: vi.fn(),
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
vi.mock('../../../src/side_panel/services/images.js', () => ({ clearImagePreviews: vi.fn() }));
vi.mock('../../../src/side_panel/ui/quote-preview.js', () => ({
  updateQuotePreview: vi.fn(),
}));

import {
  cleanupActiveFeatures,
  handleLoadChat,
  resetUIForTabSwitch,
  type UIElements,
  type GlobalEventDeps,
} from '../../../src/side_panel/shell/tab-switch-handler';
import * as stateMock from '../../../src/side_panel/state.js';
import { appendMessage, appendMessageFromHistory, scrollToBottom } from '../../../src/side_panel/ui/dom-helpers.js';

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
    detachTTS: vi.fn(),
  };
}

describe('shell/tab-switch-handler', () => {
  let els: UIElements;
  let deps: GlobalEventDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    els = createEls();
    deps = createDeps();
  });

  describe('cleanupActiveFeatures()', () => {
    it('detaches the TTS anchor (window-global audio keeps playing)', () => {
      cleanupActiveFeatures(els, deps);
      // detach-only: the shell never stops TTS — tab switches must not
      // interrupt the audio; only resource takeover or the user does.
      expect(deps.detachTTS).toHaveBeenCalledTimes(1);
    });

    it('removes existing podcast card', () => {
      const podcastCard = document.createElement('div');
      podcastCard.className = 'podcast-card';
      els.chatArea.appendChild(podcastCard);

      cleanupActiveFeatures(els, deps);

      expect(els.chatArea.querySelector('.podcast-card')).toBeNull();
    });

    it('does NOT reset podcast generating flag (background playback)', () => {
      // Podcast audio/state must survive tab switches so it can keep playing in
      // the background. cleanupActiveFeatures only detaches the card DOM; the
      // generating flag (and the global now-playing registry) stay intact.
      stateMock.getIsPodcastGenerating.mockReturnValue(true);
      cleanupActiveFeatures(els, deps);
      expect(stateMock.setIsPodcastGenerating).not.toHaveBeenCalled();
    });
  });

  describe('handleLoadChat()', () => {
    it('restores state from chat data', () => {
      handleLoadChat(els, deps, {
        id: 'chat-123',
        pageTitle: 'Test Page',
        pageContent: 'Content',
        pageExcerpt: 'Excerpt',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(stateMock.setCurrentChatId).toHaveBeenCalledWith('chat-123');
      expect(stateMock.setPageTitle).toHaveBeenCalledWith('Test Page');
      expect(stateMock.setPageContent).toHaveBeenCalledWith('Content');
      expect(stateMock.setConversationHistory).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }]);
    });

    it('defaults missing fields to empty values', () => {
      handleLoadChat(els, deps, { id: 'x' });

      expect(stateMock.setPageTitle).toHaveBeenCalledWith('');
      expect(stateMock.setPageContent).toHaveBeenCalledWith('');
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

      // appendMessageFromHistory called for each message, batched into a
      // detached fragment with per-message scrolling deferred
      expect(appendMessageFromHistory).toHaveBeenCalledTimes(2);
      expect(appendMessageFromHistory).toHaveBeenCalledWith(
        { role: 'user', content: 'question' },
        { target: expect.any(DocumentFragment), deferScroll: true },
      );
      expect(appendMessageFromHistory).toHaveBeenCalledWith(
        { role: 'assistant', content: 'answer' },
        { target: expect.any(DocumentFragment), deferScroll: true },
      );
      expect(scrollToBottom).toHaveBeenCalledTimes(1);
    });

    it('shows welcome message when no history', () => {
      stateMock.getConversationHistory.mockReturnValue([]);

      resetUIForTabSwitch(els, deps);

      expect(els.chatArea.innerHTML).toContain('welcome-msg');
    });

    it('clears suggest questions and image previews', () => {
      resetUIForTabSwitch(els, deps);
      expect(deps.removeSuggestQuestions).toHaveBeenCalled();
    });

    it('announces CHAT_RERENDERED after the chat area is rebuilt (live stream re-attach)', async () => {
      const { on, EVENTS } = await import('../../../src/side_panel/events');
      stateMock.getConversationHistory.mockReturnValue([{ role: 'user', content: 'q' }]);
      let renderedAtEvent = -1;
      const off = on(EVENTS.CHAT_RERENDERED, () => {
        renderedAtEvent = vi.mocked(appendMessageFromHistory).mock.calls.length;
      });

      resetUIForTabSwitch(els, deps);
      off();

      // fired, and only after the history messages were rendered
      expect(renderedAtEvent).toBeGreaterThan(0);
    });
  });
});
