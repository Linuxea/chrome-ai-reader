/**
 * Tests for side_panel/ui/global-events.ts — global event binding + quote preview.
 *
 * Primary test target: updateQuotePreview() (pure function).
 * Also tests bindGlobalEvents() listener registration and basic behaviors.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../src/side_panel/state.js', () => ({
  getIsGenerating: vi.fn(() => false),
  getActiveTabId: vi.fn(() => 1),
  setIsGenerating: vi.fn(),
  setSelectedText: vi.fn(),
  setPageContent: vi.fn(),
  setPageExcerpt: vi.fn(),
  setPageTitle: vi.fn(),
  clearConversation: vi.fn(),
  setCurrentChatId: vi.fn(),
  setCustomSystemPrompt: vi.fn(),
  getConversationHistory: vi.fn(() => []),
  getPageTitle: vi.fn(() => ''),
  switchToTab: vi.fn(() => Promise.resolve()),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: { SHOW_RELATED_PAGES: 'showRelatedPages' },
}));
vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({
  setButtonsDisabled: vi.fn(),
  updateSendButtonDim: vi.fn(),
}));
vi.mock('../../../src/side_panel/ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/side_panel/features/quick-commands.js', () => ({
  isCommandPopupOpen: vi.fn(() => false),
  hideCommandPopup: vi.fn(),
  updateCommandPopup: vi.fn(),
}));
vi.mock('../../../src/side_panel/services/images.js', () => ({ clearImagePreviews: vi.fn() }));
vi.mock('../../../src/side_panel/features/chat-history.js', () => ({
  saveCurrentChat: vi.fn(),
  getDisplayMessages: vi.fn(() => []),
  generateTitle: vi.fn(() => 'Title'),
  exportChatAsMarkdown: vi.fn(),
  renderHistoryList: vi.fn(),
}));
vi.mock('../../../src/side_panel/ui/tab-switch-handler.js', () => ({
  resetUIForTabSwitch: vi.fn(),
  cleanupActiveFeatures: vi.fn(),
}));

import { updateQuotePreview, bindGlobalEvents, type UIElements, type GlobalEventDeps } from '../../../src/side_panel/ui/global-events';
import * as stateMock from '../../../src/side_panel/state.js';
import * as eventsMock from '../../../src/side_panel/events.js';
import * as chatHistoryMock from '../../../src/side_panel/features/chat-history.js';
import * as quickCommandsMock from '../../../src/side_panel/features/quick-commands.js';
import * as domMock from '../../../src/side_panel/ui/dom-helpers.js';
import { showToast } from '../../../src/side_panel/ui/toast.js';

function createUIElements(): UIElements {
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

describe('ui/global-events', () => {
  let els: UIElements;
  let deps: GlobalEventDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    els = createUIElements();
    deps = createDeps();
  });

  describe('updateQuotePreview()', () => {
    it('shows quote text (truncated >50 chars) and unhides preview', () => {
      els.quotePreview.classList.add('hidden');
      const longText = 'A'.repeat(60);
      updateQuotePreview(els, longText);

      expect(stateMock.setSelectedText).toHaveBeenCalledWith(longText);
      expect(els.quoteText.textContent).toBe('A'.repeat(50) + '...');
      expect(els.quotePreview.classList.contains('hidden')).toBe(false);
    });

    it('shows short text without truncation', () => {
      els.quotePreview.classList.add('hidden');
      updateQuotePreview(els, 'short');

      expect(els.quoteText.textContent).toBe('short');
      expect(els.quotePreview.classList.contains('hidden')).toBe(false);
    });

    it('hides preview and clears text when text is empty', () => {
      els.quoteText.textContent = 'old text';
      updateQuotePreview(els, '');

      expect(stateMock.setSelectedText).toHaveBeenCalledWith('');
      expect(els.quoteText.textContent).toBe('');
      expect(els.quotePreview.classList.contains('hidden')).toBe(true);
    });

    it('truncates at exactly 50 characters boundary (50 = no truncation)', () => {
      const text50 = 'B'.repeat(50);
      updateQuotePreview(els, text50);
      expect(els.quoteText.textContent).toBe(text50);
    });

    it('truncates at 51 characters (>50 triggers truncation)', () => {
      const text51 = 'C'.repeat(51);
      updateQuotePreview(els, text51);
      expect(els.quoteText.textContent).toBe('C'.repeat(50) + '...');
    });
  });

  describe('bindGlobalEvents()', () => {
    beforeEach(() => {
      globalThis.chrome = {
        runtime: { openOptionsPage: vi.fn(), onMessage: { addListener: vi.fn() } },
        tabs: { onActivated: { addListener: vi.fn() } },
        storage: { onChanged: { addListener: vi.fn() } },
      } as unknown as typeof chrome;
    });

    it('newChatBtn clears state and shows welcome message when not generating', () => {
      bindGlobalEvents(els, deps);
      els.newChatBtn.click();

      expect(stateMock.clearConversation).toHaveBeenCalled();
      expect(stateMock.setPageContent).toHaveBeenCalledWith('');
      expect(deps.removeSuggestQuestions).toHaveBeenCalled();
      expect(els.chatArea.innerHTML).toContain('welcome-msg');
    });

    it('newChatBtn does nothing when generating', () => {
      stateMock.getIsGenerating.mockReturnValue(true);
      bindGlobalEvents(els, deps);
      els.newChatBtn.click();

      expect(stateMock.clearConversation).not.toHaveBeenCalled();
      // …but says why instead of ignoring the click
      expect(showToast).toHaveBeenCalledWith('[toast.busyGenerating]', expect.any(Number));
    });

    it('exportBtn calls exportChatAsMarkdown when messages exist', () => {
      chatHistoryMock.getDisplayMessages.mockReturnValue([{ role: 'user', content: 'hi' }]);
      bindGlobalEvents(els, deps);
      els.exportBtn.click();

      expect(chatHistoryMock.exportChatAsMarkdown).toHaveBeenCalled();
    });

    it('exportBtn does nothing when no messages', () => {
      chatHistoryMock.getDisplayMessages.mockReturnValue([]);
      bindGlobalEvents(els, deps);
      els.exportBtn.click();

      expect(chatHistoryMock.exportChatAsMarkdown).not.toHaveBeenCalled();
    });

    it('historyBtn shows history panel', () => {
      bindGlobalEvents(els, deps);
      els.historyPanel.classList.add('hidden');
      els.historyBtn.click();

      expect(chatHistoryMock.renderHistoryList).toHaveBeenCalled();
      expect(els.historyPanel.classList.contains('hidden')).toBe(false);
    });

    it('historyBackBtn hides history panel', () => {
      bindGlobalEvents(els, deps);
      els.historyBackBtn.click();

      expect(els.historyPanel.classList.contains('hidden')).toBe(true);
    });

    it('quoteClose clears quote preview', () => {
      bindGlobalEvents(els, deps);
      els.quoteText.textContent = 'some quote';
      els.quoteClose.click();

      expect(els.quoteText.textContent).toBe('');
      expect(els.quotePreview.classList.contains('hidden')).toBe(true);
    });

    it('registers chrome.tabs.onActivated listener', () => {
      bindGlobalEvents(els, deps);
      expect(chrome.tabs.onActivated.addListener).toHaveBeenCalled();
    });

    describe('tab activation', () => {
      type Activated = (info: { tabId: number; windowId: number }) => Promise<void>;
      function activatedListener(): Activated {
        return vi.mocked(chrome.tabs.onActivated.addListener).mock.calls[0][0] as unknown as Activated;
      }

      beforeEach(() => {
        (chrome as unknown as { windows: unknown }).windows = { getCurrent: vi.fn(() => Promise.resolve({ id: 7 })) };
        stateMock.getActiveTabId.mockReturnValue(1);
      });

      it('does not clear the outgoing tab\'s generating flag, and shows Stop if the new tab is generating', async () => {
        bindGlobalEvents(els, deps);
        await Promise.resolve(); // windows.getCurrent resolves
        stateMock.getIsGenerating.mockReturnValue(true); // the tab being switched TO is generating

        await activatedListener()({ tabId: 2, windowId: 7 });

        expect(stateMock.setIsGenerating).not.toHaveBeenCalled();
        expect(stateMock.switchToTab).toHaveBeenCalledWith(2);
        expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(true);
      });

      it('ignores tab activations in other browser windows', async () => {
        bindGlobalEvents(els, deps);
        await Promise.resolve();

        await activatedListener()({ tabId: 2, windowId: 99 });

        expect(stateMock.switchToTab).not.toHaveBeenCalled();
      });
    });

    it('registers chrome.runtime.onMessage listener', () => {
      bindGlobalEvents(els, deps);
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('registers chrome.storage.onChanged listener', () => {
      bindGlobalEvents(els, deps);
      expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
    });

    it('userInput typing "/" triggers updateCommandPopup', () => {
      bindGlobalEvents(els, deps);
      els.userInput.value = '/summarize';
      els.userInput.dispatchEvent(new Event('input'));

      expect(quickCommandsMock.updateCommandPopup).toHaveBeenCalledWith('/summarize');
    });
  });
});
