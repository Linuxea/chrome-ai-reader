/**
 * Shell: binds the panel's global controls (header buttons, input, tab
 * activation, selection relay) to services and features. As part of the
 * composition root it may import every side-panel layer; nothing below
 * imports it (enforced by .dependency-cruiser.cjs).
 */
import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { setButtonsDisabled, updateSendButtonDim } from '../ui/dom-helpers';
import { showToast } from '../ui/toast';
import { updateQuotePreview } from '../ui/quote-preview';
import { isCommandPopupOpen, hideCommandPopup, updateCommandPopup } from '../features/quick-commands.js';
import { clearImagePreviews } from '../services/images.js';
import { saveCurrentChat, getDisplayMessages, generateTitle, exportChatAsMarkdown, renderHistoryList } from '../features/chat-history.js';
import { emit, EVENTS } from '../events';
import { resetUIForTabSwitch, cleanupActiveFeatures } from './tab-switch-handler.js';
import type { UIElements, GlobalEventDeps } from './types';

export type { UIElements, GlobalEventDeps } from './types';
export { updateQuotePreview } from '../ui/quote-preview';

export function bindGlobalEvents(els: UIElements, deps: GlobalEventDeps): void {
  els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.newChatBtn.addEventListener('click', () => {
    if (state.getIsGenerating()) {
      showToast(t('toast.busyGenerating'), 2500);
      return;
    }
    cleanupActiveFeatures(els, deps);
    saveCurrentChat();
    deps.removeSuggestQuestions();
    state.setPageContent('');
    state.setPageExcerpt('');
    state.setPageTitle('');
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

  // Auto-grow the textarea to fit its content up to a cap, then scroll inside.
  // overflow-y is forced 'hidden' while under the cap so a subpixel rounding
  // mismatch between scrollHeight and the integer height can't surface a
  // phantom vertical scrollbar for short/single-line input.
  const INPUT_MAX_HEIGHT = 120;
  const autoResize = (): void => {
    const ta = els.userInput;
    ta.style.height = 'auto';
    const capped = Math.min(ta.scrollHeight, INPUT_MAX_HEIGHT);
    ta.style.height = capped + 'px';
    ta.style.overflowY = ta.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  };
  autoResize();
  els.userInput.addEventListener('input', () => {
    autoResize();
    updateSendButtonDim();
    const value = els.userInput.value;
    if (value.startsWith('/')) updateCommandPopup(value);
    else if (isCommandPopupOpen()) hideCommandPopup();
  });

  // The side panel belongs to one window; tab activations in other windows
  // must not swap this panel's conversation.
  let panelWindowId: number | undefined;
  chrome.windows?.getCurrent?.().then((w) => { panelWindowId = w.id; }).catch(() => { /* keep unfiltered */ });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (panelWindowId !== undefined && activeInfo.windowId !== panelWindowId) return;
    if (activeInfo.tabId === state.getActiveTabId()) return;
    // The outgoing tab's generation keeps running in the background — do NOT
    // clear its generating flag (that used to let a second send interleave
    // with the first and hid the Stop button on return).
    cleanupActiveFeatures(els, deps);
    await state.switchToTab(activeInfo.tabId);
    // Send vs Stop reflects the tab now shown.
    setButtonsDisabled(state.getIsGenerating());
    resetUIForTabSwitch(els, deps);
    emit(EVENTS.SHOW_RELATED_PAGES);
  });

  // The active tab navigated to another page: its quote belongs to the old
  // page, and the related-reading panel should reflect the new URL.
  state.subscribe('pageInvalidated', (tabId) => {
    if (tabId !== state.getActiveTabId()) return;
    updateQuotePreview(els, '');
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
}
