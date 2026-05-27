// ui/global-events.js — 全局 DOM 事件绑定与 quote 预览更新

import { t } from '../../shared/i18n.js';
import * as state from '../state.js';
import { setButtonsDisabled } from './dom-helpers.js';
import { isCommandPopupOpen, hideCommandPopup, updateCommandPopup } from '../features/quick-commands.js';
import { clearImagePreviews } from '../services/ocr.js';
import { saveCurrentChat, getDisplayMessages, generateTitle, exportChatAsMarkdown, renderHistoryList } from '../features/chat-history.js';
import { resetUIForTabSwitch, cleanupActiveFeatures } from './tab-switch-handler.js';

export function updateQuotePreview(els, text) {
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

// 所有依赖通过 deps 注入，避免循环引用
export function bindGlobalEvents(els, deps) {
  els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.newChatBtn.addEventListener('click', () => {
    if (state.getIsGenerating()) return;
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

  // 标签页切换时重置 UI 状态
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (activeInfo.tabId === state.getActiveTabId()) return;
    state.setIsGenerating(false);
    cleanupActiveFeatures(els, deps);
    await state.switchToTab(activeInfo.tabId);
    setButtonsDisabled(false);
    resetUIForTabSwitch(els, deps);
  });

  // 页面文本选区变化，更新引用预览
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'selectionChanged') {
      if (!msg.forwarded) return;
      const tabId = state.getActiveTabId();
      if (tabId && msg.tabId && msg.tabId !== tabId) return;
      updateQuotePreview(els, msg.text);
    }
  });

  // 系统提示词热更新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.systemPrompt) {
      state.setCustomSystemPrompt(changes.systemPrompt.newValue || '');
    }
  });

  // 输入框自适应高度 + 斜杠命令弹窗
  els.userInput.addEventListener('input', () => {
    els.userInput.style.height = 'auto';
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 120) + 'px';
    const value = els.userInput.value;
    if (value.startsWith('/')) updateCommandPopup(value);
    else if (isCommandPopupOpen()) hideCommandPopup();
  });
}
