import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { setButtonsDisabled } from './dom-helpers';
import { isCommandPopupOpen, hideCommandPopup, updateCommandPopup } from '../features/quick-commands.js';
import { clearImagePreviews } from '../services/ocr.js';
import { saveCurrentChat, getDisplayMessages, generateTitle, exportChatAsMarkdown, renderHistoryList } from '../features/chat-history.js';
import { emit, EVENTS } from '../events';
import { resetUIForTabSwitch, cleanupActiveFeatures } from './tab-switch-handler.js';

export interface UIElements {
  settingsBtn: HTMLElement;
  newChatBtn: HTMLElement;
  exportBtn: HTMLElement;
  historyBtn: HTMLElement;
  historyBackBtn: HTMLElement;
  quoteClose: HTMLElement;
  chatArea: HTMLElement;
  quoteText: HTMLElement;
  quotePreview: HTMLElement;
  historyPanel: HTMLElement;
  historyList: HTMLElement;
  userInput: HTMLTextAreaElement;
}

export interface GlobalEventDeps {
  removeSuggestQuestions: () => void;
  isTTSPlaying: () => boolean;
  stopTTS: () => void;
}

/** Subset of UIElements that updateQuotePreview touches. Accepting a Pick lets
 *  callers (e.g. the annotation feature) pass just these two elements. */
type QuotePreviewEls = Pick<UIElements, 'quoteText' | 'quotePreview'>;

export function updateQuotePreview(els: QuotePreviewEls, text: string): void {
  state.setSelectedText(text);
  if (text) {
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    els.quoteText.textContent = truncated;
    els.quotePreview.classList.remove('hidden');
  } else {
    els.quoteText.textContent = '';
    els.quotePreview.classList.add('hidden');
  }
}

export function bindGlobalEvents(els: UIElements, deps: GlobalEventDeps): void {
  els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.newChatBtn.addEventListener('click', () => {
    if (state.getIsGenerating()) return;
    cleanupActiveFeatures(els, deps);
    saveCurrentChat();
    deps.removeSuggestQuestions();
    state.setPageContent('');
    state.setPageExcerpt('');
    state.setPageTitle('');
    state.setArticleSummary('');
    state.setArticleSummaryStatus('idle');
    state.setArticleSummaryUrl('');
    state.clearConversation();
    state.setCurrentChatId(null);
    updateQuotePreview(els, '');
    clearImagePreviews();
    els.chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
  });

  els.exportBtn.addEventListener('click', () => {
    const messages = getDisplayMessages();
    if (messages.length === 0) return;
    exportChatAsMarkdown({
      title: generateTitle(messages),
      messages,
      conversationHistory: state.getConversationHistory(),
      pageTitle: state.getPageTitle(),
    });
  });

  els.historyBtn.addEventListener('click', () => {
    renderHistoryList();
    els.historyPanel.classList.remove('hidden');
  });
  els.historyBackBtn.addEventListener('click', () => {
    els.historyPanel.classList.add('hidden');
  });

  els.quoteClose.addEventListener('click', () => updateQuotePreview(els, ''));

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (activeInfo.tabId === state.getActiveTabId()) return;
    state.setIsGenerating(false);
    cleanupActiveFeatures(els, deps);
    await state.switchToTab(activeInfo.tabId);
    setButtonsDisabled(false);
    resetUIForTabSwitch(els, deps);
    emit(EVENTS.TAB_CHANGED, { tabId: activeInfo.tabId });
    emit(EVENTS.SHOW_RELATED_PAGES);
  });

  chrome.runtime.onMessage.addListener((msg: { action?: string; forwarded?: boolean; tabId?: number; text?: string }) => {
    if (msg.action === 'selectionChanged') {
      if (!msg.forwarded) return;
      const tabId = state.getActiveTabId();
      if (tabId && msg.tabId && msg.tabId !== tabId) return;
      if (msg.text) updateQuotePreview(els, msg.text);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.systemPrompt) {
      state.setCustomSystemPrompt((changes.systemPrompt.newValue as string) || '');
    }
  });

  els.userInput.addEventListener('input', () => {
    els.userInput.style.height = 'auto';
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 120) + 'px';
    const value = els.userInput.value;
    if (value.startsWith('/')) updateCommandPopup(value);
    else if (isCommandPopupOpen()) hideCommandPopup();
  });
}
