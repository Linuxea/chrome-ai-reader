// main.js — ES Module entry point for side_panel

import { loadLanguage, t } from '../shared/i18n.js';
import { initState } from './state.js';
import * as state from './state.js';
import { initDOMHelpers, setButtonsDisabled, appendMessage, scrollToBottom } from './ui/dom-helpers.js';
import { initTheme } from './ui/theme.js';
import { initModelStatus } from './ui/model-status.js';
import { initTTS, isTTSPlaying, stopTTS, addTTSButton } from './services/tts.js';
import { initOCR, clearImagePreviews } from './services/ocr.js';
import { initAIChat, sendToAI, sendMessage, retryMessage, extractPageContent } from './services/ai-chat.js';
import { initChatHistory, saveCurrentChat, getDisplayMessages, generateTitle, exportChatAsMarkdown, renderHistoryList } from './features/chat-history.js';
import { initQuickCommands, isCommandPopupOpen, updateCommandPopup, hideCommandPopup, getFilteredCommands, renderCommandPopup, executeQuickCommand } from './features/quick-commands.js';
import { initSuggestQuestions, removeSuggestQuestions, generateSuggestions } from './features/suggest-questions.js';
import { initOutline, generateOutline, renderOutlineFromJSON, outlineToMarkdown } from './features/outline.js';
import { initImageInput } from './features/image-input.js';
import { initPodcast } from './features/podcast.js';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

const els = {
  chatArea: document.getElementById('chatArea'),
  userInput: document.getElementById('userInput'),
  sendBtn: document.getElementById('sendBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  exportBtn: document.getElementById('exportBtn'),
  historyBtn: document.getElementById('historyBtn'),
  historyPanel: document.getElementById('historyPanel'),
  historyBackBtn: document.getElementById('historyBackBtn'),
  historyList: document.getElementById('historyList'),
  actionBtns: document.querySelectorAll('.action-btn'),
  quotePreview: document.getElementById('quotePreview'),
  quoteText: document.getElementById('quoteText'),
  quoteClose: document.getElementById('quoteClose'),
  imagePreviewBar: document.getElementById('imagePreviewBar'),
  commandPopup: document.getElementById('commandPopup'),
};

async function init() {
  // 1. Async inits (parallel)
  await Promise.all([loadLanguage(), initState()]);

  // 2. UI layer
  initDOMHelpers({
    chatArea: els.chatArea,
    actionBtns: els.actionBtns,
    sendBtn: els.sendBtn,
    callbacks: { onRetry: retryMessage },
  });
  initTheme();
  initModelStatus();

  // 3. Services
  initTTS({ chatArea: els.chatArea });
  initOCR();

  // 4. Features (wire callbacks to break cycles)
  initChatHistory({
    chatArea: els.chatArea,
    historyPanel: els.historyPanel,
    historyList: els.historyList,
    onLoadChat: handleLoadChat,
    onRenderOutline: renderOutlineFromJSON,
    onOutlineToMarkdown: outlineToMarkdown,
  });
  initQuickCommands({
    userInput: els.userInput,
    commandPopup: els.commandPopup,
    onSendToAI: sendToAI,
  });
  initSuggestQuestions({
    chatArea: els.chatArea,
    userInput: els.userInput,
    onSend: sendMessage,
  });
  initOutline({
    onExtractPageContent: extractPageContent,
    onStopTTS: stopTTS,
    onAddTTSButton: addTTSButton,
    onAppendMessage: appendMessage,
    onScrollToBottom: scrollToBottom,
    onSetButtonsDisabled: setButtonsDisabled,
    onRemoveSuggestQuestions: removeSuggestQuestions,
    onSaveCurrentChat: saveCurrentChat,
    chatArea: els.chatArea,
  });
  initImageInput({
    userInput: els.userInput,
    imagePreviewBar: els.imagePreviewBar,
  });
  initPodcast({
    chatArea: els.chatArea,
  });

  // 5. AI chat (last — injects feature callbacks to avoid layer violation)
  initAIChat({
    chatArea: els.chatArea,
    userInput: els.userInput,
    sendBtn: els.sendBtn,
    actionBtns: els.actionBtns,
    callbacks: {
      onRetry: retryMessage,
      onRemoveSuggestQuestions: removeSuggestQuestions,
      onGenerateSuggestions: (msgEl, history) => {
        generateSuggestions(msgEl, history);
        saveCurrentChat();
      },
      onGenerateOutline: generateOutline,
      onClearQuotePreview: () => updateQuotePreview(''),
    },
    isCommandPopupOpen,
    getFilteredCommands,
    renderCommandPopup,
    hideCommandPopup,
    executeQuickCommand,
  });

  // 6. Global event bindings
  bindGlobalEvents();
}

function handleLoadChat(chatData) {
  state.setCurrentChatId(chatData.id);
  state.setPageTitle(chatData.pageTitle || '');
  state.setPageContent(chatData.pageContent || '');
  state.setPageExcerpt(chatData.pageExcerpt || '');
  state.setConversationHistory(chatData.messages || []);
  updateQuotePreview('');
  clearImagePreviews();
}

function bindGlobalEvents() {
  els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.newChatBtn.addEventListener('click', () => {
    if (state.getIsGenerating()) return;
    if (isTTSPlaying()) stopTTS();
    // Clean up any active podcast card
    const existingPodcast = els.chatArea.querySelector('.podcast-card');
    if (existingPodcast) existingPodcast.remove();
    if (state.getIsPodcastGenerating()) state.setIsPodcastGenerating(false);
    saveCurrentChat();
    removeSuggestQuestions();
    state.setPageContent('');
    state.setPageExcerpt('');
    state.setPageTitle('');
    state.clearConversation();
    state.setCurrentChatId(null);
    updateQuotePreview('');
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

  els.quoteClose.addEventListener('click', () => updateQuotePreview(''));

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'selectionChanged') {
      const tabId = state.getActiveTabId();
      if (tabId && msg.tabId && msg.tabId !== tabId) return;
      updateQuotePreview(msg.text);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.systemPrompt) {
      state.setCustomSystemPrompt(changes.systemPrompt.newValue || '');
    }
  });

  els.userInput.addEventListener('input', () => {
    els.userInput.style.height = 'auto';
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 100) + 'px';
    const value = els.userInput.value;
    if (value.startsWith('/')) updateCommandPopup(value);
    else if (isCommandPopupOpen()) hideCommandPopup();
  });
}

function updateQuotePreview(text) {
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

init();
