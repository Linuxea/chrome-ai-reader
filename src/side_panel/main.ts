import { loadLanguage } from '../shared/i18n.js';
import { initState } from './state';
import * as state from './state';
import { on, EVENTS } from './events';
import { initDOMHelpers } from './ui/dom-helpers';
import { initTheme } from './ui/theme';
import { initModelStatus } from './ui/model-status';
import { initTTS, isTTSPlaying, stopTTS, addTTSButton } from './services/tts/index.js';
import { initOCR, clearImagePreviews } from './services/ocr.js';
import { initAIChat, sendToAI, sendMessage, retryMessage, extractPageContent } from './services/ai-chat';
import { initChatHistory, saveCurrentChat } from './features/chat-history';
import { initQuickCommands, isCommandPopupOpen, hideCommandPopup, getFilteredCommands, renderCommandPopup, executeQuickCommand, getCommandSelectedIndex, setCommandSelectedIndex } from './features/quick-commands';
import { initSuggestQuestions, removeSuggestQuestions, generateSuggestions } from './features/suggest-questions';
import { initOutline, generateOutline, renderOutlineFromJSON, outlineToMarkdown } from './features/outline';
import { initImageInput } from './features/image-input';
import { initPodcast, handlePodcastClick } from './features/podcast/index.js';
import { initChartAnalyzer, handleChartClick } from './features/chart-analyzer';
import { bindGlobalEvents, updateQuotePreview } from './ui/global-events';
import type { UIElements } from './ui/global-events';
import { handleLoadChat, resetUIForTabSwitch } from './ui/tab-switch-handler';
import { marked } from 'marked';
import type { ChatMessage } from '../shared/types';

marked.setOptions({ breaks: true, gfm: true });

const els = {
  chatArea: document.getElementById('chatArea')!,
  userInput: document.getElementById('userInput') as HTMLTextAreaElement,
  settingsBtn: document.getElementById('settingsBtn')!,
  newChatBtn: document.getElementById('newChatBtn')!,
  exportBtn: document.getElementById('exportBtn')!,
  historyBtn: document.getElementById('historyBtn')!,
  historyPanel: document.getElementById('historyPanel')!,
  historyBackBtn: document.getElementById('historyBackBtn')!,
  historyList: document.getElementById('historyList')!,
  quotePreview: document.getElementById('quotePreview')!,
  quoteText: document.getElementById('quoteText')!,
  quoteClose: document.getElementById('quoteClose')!,
} as unknown as UIElements;

const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
const actionBtns = document.querySelectorAll('.action-btn') as NodeListOf<HTMLButtonElement>;
const imagePreviewBar = document.getElementById('imagePreviewBar')!;
const commandPopup = document.getElementById('commandPopup')!;

const deps = { isTTSPlaying, stopTTS, removeSuggestQuestions, clearImagePreviews };

async function init(): Promise<void> {
  await Promise.all([loadLanguage(), initState()]);

  initDOMHelpers({ chatArea: els.chatArea, actionBtns, sendBtn });
  initTheme();
  initModelStatus();

  initTTS({ chatArea: els.chatArea });
  initOCR();

  initChatHistory({
    chatArea: els.chatArea,
    historyPanel: els.historyPanel,
    historyList: els.historyList,
    onLoadChat: (chatData) => handleLoadChat(els, deps, chatData),
    onRenderOutline: renderOutlineFromJSON,
    onOutlineToMarkdown: outlineToMarkdown as (data: unknown) => string,
  });
  initQuickCommands({ userInput: els.userInput, commandPopup, onSendToAI: sendToAI });
  initSuggestQuestions({ chatArea: els.chatArea, userInput: els.userInput, onSend: sendMessage });
  initOutline({ onExtractPageContent: extractPageContent });
  initImageInput({ userInput: els.userInput, imagePreviewBar });
  initPodcast({ chatArea: els.chatArea });
  initChartAnalyzer({ chatArea: els.chatArea });

  on(EVENTS.RETRY, (args) => { const { wrapper, rawText, rawDisplay, rawQuote } = args as { wrapper: HTMLElement; rawText: string; rawDisplay: string; rawQuote: string }; retryMessage(wrapper, rawText, rawDisplay, rawQuote); });
  on(EVENTS.REMOVE_SUGGEST_QUESTIONS, () => removeSuggestQuestions());
  on(EVENTS.REQUEST_RERENDER, () => resetUIForTabSwitch(els, deps));
  on(EVENTS.GENERATE_SUGGESTIONS, (args) => { const { msgEl, history } = args as { msgEl: HTMLElement; history: ChatMessage[] }; generateSuggestions(msgEl, history); saveCurrentChat(); });
  on(EVENTS.GENERATE_OUTLINE, () => generateOutline());
  on(EVENTS.CLEAR_QUOTE_PREVIEW, () => updateQuotePreview(els, ''));
  on(EVENTS.CHART_CLICK, () => handleChartClick());
  on(EVENTS.PODCAST_CLICK, () => handlePodcastClick());
  on(EVENTS.ADD_TTS_BUTTON, (args) => { addTTSButton((args as { msgEl: HTMLElement }).msgEl); });
  on(EVENTS.SAVE_CURRENT_CHAT, () => saveCurrentChat());

  initAIChat({
    chatArea: els.chatArea,
    userInput: els.userInput,
    sendBtn,
    actionBtns,
    isCommandPopupOpen,
    getFilteredCommands,
    renderCommandPopup,
    hideCommandPopup,
    executeQuickCommand,
    getCommandSelectedIndex,
    setCommandSelectedIndex,
  });

  bindGlobalEvents(els, deps);

  if (state.getConversationHistory().length > 0) {
    resetUIForTabSwitch(els, deps);
  }
}

init();
