// main.js — ES Module entry point for side_panel（仅初始化编排）

import { loadLanguage } from '../shared/i18n.js';
import { initState } from './state.js';
import * as state from './state.js';
import { on, EVENTS } from './events.js';
import { initDOMHelpers } from './ui/dom-helpers.js';
import { initTheme } from './ui/theme.js';
import { initModelStatus } from './ui/model-status.js';
import { initTTS, isTTSPlaying, stopTTS, addTTSButton } from './services/tts/index.js';
import { initOCR, clearImagePreviews } from './services/ocr.js';
import { initAIChat, sendToAI, sendMessage, retryMessage, extractPageContent } from './services/ai-chat.js';
import { initChatHistory } from './features/chat-history.js';
import { initQuickCommands, isCommandPopupOpen, hideCommandPopup, getFilteredCommands, renderCommandPopup, executeQuickCommand, getCommandSelectedIndex, setCommandSelectedIndex } from './features/quick-commands.js';
import { initSuggestQuestions, removeSuggestQuestions, generateSuggestions } from './features/suggest-questions.js';
import { initOutline, generateOutline, renderOutlineFromJSON, outlineToMarkdown } from './features/outline.js';
import { initImageInput } from './features/image-input.js';
import { initPodcast, handlePodcastClick } from './features/podcast/index.js';
import { initChartAnalyzer, handleChartClick } from './features/chart-analyzer.js';
import { bindGlobalEvents, updateQuotePreview } from './ui/global-events.js';
import { handleLoadChat, resetUIForTabSwitch } from './ui/tab-switch-handler.js';
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

// 传递给子模块的共享依赖，避免循环引用
const deps = { isTTSPlaying, stopTTS, removeSuggestQuestions, clearImagePreviews };

async function init() {
  // 1. Async inits (parallel)
  await Promise.all([loadLanguage(), initState()]);

  // 2. UI layer
  initDOMHelpers({
    chatArea: els.chatArea,
    actionBtns: els.actionBtns,
    sendBtn: els.sendBtn,
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
    onLoadChat: (chatData) => handleLoadChat(els, deps, chatData),
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
  });
  initImageInput({
    userInput: els.userInput,
    imagePreviewBar: els.imagePreviewBar,
  });
  initPodcast({
    chatArea: els.chatArea,
  });
  initChartAnalyzer({ chatArea: els.chatArea });

  // 4b. Event subscriptions (replaces callback injection)
  on(EVENTS.RETRY, ({ wrapper, rawText, rawDisplay, rawQuote }) => retryMessage(wrapper, rawText, rawDisplay, rawQuote));
  on(EVENTS.REMOVE_SUGGEST_QUESTIONS, () => removeSuggestQuestions());
  on(EVENTS.REQUEST_RERENDER, () => resetUIForTabSwitch(els, deps));
  on(EVENTS.GENERATE_SUGGESTIONS, ({ msgEl, history }) => {
    generateSuggestions(msgEl, history);
    saveCurrentChat();
  });
  on(EVENTS.GENERATE_OUTLINE, () => generateOutline());
  on(EVENTS.CLEAR_QUOTE_PREVIEW, () => updateQuotePreview(els, ''));
  on(EVENTS.CHART_CLICK, () => handleChartClick());
  on(EVENTS.PODCAST_CLICK, () => handlePodcastClick());
  on(EVENTS.ADD_TTS_BUTTON, ({ msgEl }) => addTTSButton(msgEl));
  on(EVENTS.SAVE_CURRENT_CHAT, () => saveCurrentChat());

  // 5. AI chat (last — command popup helpers still injected for synchronous queries)
  initAIChat({
    chatArea: els.chatArea,
    userInput: els.userInput,
    sendBtn: els.sendBtn,
    actionBtns: els.actionBtns,
    isCommandPopupOpen,
    getFilteredCommands,
    renderCommandPopup,
    hideCommandPopup,
    executeQuickCommand,
    getCommandSelectedIndex,
    setCommandSelectedIndex,
  });

  // 6. Global event bindings
  bindGlobalEvents(els, deps);

  // 7. Render persisted conversation on initial load (side panel reopen, etc.)
  if (state.getConversationHistory().length > 0) {
    resetUIForTabSwitch(els, deps);
  }
}

init();
