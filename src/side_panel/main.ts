import { loadLanguage } from '../shared/i18n.js';
import { t } from '../shared/i18n.js';
import { initState } from './state';
import * as state from './state';
import { on, EVENTS } from './events';
import { initDOMHelpers, appendMessage } from './ui/dom-helpers';
import { initTheme } from './ui/theme';
import { initModelStatus } from './ui/model-status';
import { initTTS, isTTSPlaying, stopTTS, addTTSButton } from './services/tts/index.js';
import { initOCR, clearImagePreviews, addImageDataUri } from './services/ocr.js';
import { captureVisibleTab } from './services/screenshot';
import { getSync, onSyncChange } from '../platform/storage';
import { openOptionsPage } from '../platform/messaging';
import { initAIChat } from './services/ai-chat';
import { sendToAI, sendMessage, retryMessage, editMessage } from './services/message-sender';
import { initChatHistory, saveCurrentChat } from './features/chat-history';
import { initQuickCommands, isCommandPopupOpen, hideCommandPopup, getFilteredCommands, renderCommandPopup, executeQuickCommand, getCommandSelectedIndex, setCommandSelectedIndex } from './features/quick-commands';
import { initSuggestQuestions, removeSuggestQuestions, generateSuggestions } from './features/suggest-questions';
import { renderOutlineFromJSON, outlineToMarkdown } from './features/outline';
import { initImageInput } from './features/image-input';
import { initPodcast, handlePodcastClick } from './features/podcast/index.js';
import { initMiniPlayer } from './features/podcast/mini-player.js';
import { initRelatedPages, renderRelatedPages } from './features/related-pages';
import { initAnnotation } from './features/annotation';
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
const commandPopup = document.getElementById('commandPopup')!;

const deps = { isTTSPlaying, stopTTS, removeSuggestQuestions, clearImagePreviews };

async function init(): Promise<void> {
  await Promise.all([loadLanguage(), initState()]);

  initDOMHelpers({ chatArea: els.chatArea, actionBtns, sendBtn, userInput: els.userInput });
  initTheme();
  initModelStatus();

  initTTS({ chatArea: els.chatArea });
  initOCR();

  // 视觉分析按钮：显隐由 visionEnabled 控制，onSyncChange 实时联动
  const visionCaptureBtn = document.getElementById('visionCaptureBtn')!;
  const { visionEnabled } = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
  if (visionEnabled) visionCaptureBtn.classList.remove('hidden');

  // Listener lives for the panel's lifetime; side panel is a single-page
  // context that unloads cleanly on close, so no explicit unsubscribe needed.
  onSyncChange('visionEnabled', (val) => {
    if (val === true) visionCaptureBtn.classList.remove('hidden');
    else visionCaptureBtn.classList.add('hidden');
  });

  visionCaptureBtn.addEventListener('click', async () => {
    try {
      const dataUri = await captureVisibleTab();
      const name = t('screenshot.defaultName', { time: new Date().toLocaleString() });
      await addImageDataUri(dataUri, name);
    } catch (e) {
      appendMessage('error', t('error.screenshotFailed') + (e instanceof Error ? `：${e.message}` : ''));
    }
  });

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
  initImageInput({ userInput: els.userInput });
  initPodcast({ chatArea: els.chatArea });
  initMiniPlayer();
  initRelatedPages({ chatArea: els.chatArea });
  const annotationBtn = document.querySelector<HTMLButtonElement>('[data-action="annotation"]');
  if (annotationBtn) {
    initAnnotation({
      button: annotationBtn,
      userInput: els.userInput,
      quoteText: els.quoteText,
      quotePreview: els.quotePreview,
    });
  }

  on(EVENTS.RETRY, (args) => { const { wrapper, rawText, rawDisplay, rawQuote } = args as { wrapper: HTMLElement; rawText: string; rawDisplay: string; rawQuote: string }; retryMessage(wrapper, rawText, rawDisplay, rawQuote); });
  on(EVENTS.EDIT, (args) => { const { wrapper, originalRawText, editedText, rawQuote } = args as { wrapper: HTMLElement; originalRawText: string; editedText: string; rawQuote: string }; editMessage(wrapper, originalRawText, editedText, rawQuote); });
  on(EVENTS.REMOVE_SUGGEST_QUESTIONS, () => removeSuggestQuestions());
  on(EVENTS.REQUEST_RERENDER, () => resetUIForTabSwitch(els, deps));
  on(EVENTS.GENERATE_SUGGESTIONS, (args) => { const { msgEl, history } = args as { msgEl: HTMLElement; history: ChatMessage[] }; generateSuggestions(msgEl, history); saveCurrentChat(); });
  on(EVENTS.CLEAR_QUOTE_PREVIEW, () => updateQuotePreview(els, ''));
  on(EVENTS.PODCAST_CLICK, () => handlePodcastClick());
  on(EVENTS.ADD_TTS_BUTTON, (args) => { addTTSButton((args as { msgEl: HTMLElement }).msgEl); });
  on(EVENTS.SAVE_CURRENT_CHAT, () => saveCurrentChat());
  on(EVENTS.SHOW_RELATED_PAGES, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) renderRelatedPages(tabs[0].url);
    });
  });

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
  } else {
    renderOnboardingIfNeeded();
  }

  // Show related pages for current tab on init
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) renderRelatedPages(tabs[0].url);
  });
}

/**
 * First-run onboarding: without an API key or model configured, replace the
 * bare welcome line with a setup card linking to the options page. Skipped
 * once any conversation exists (the user is past setup).
 */
async function renderOnboardingIfNeeded(): Promise<void> {
  const { apiKey, modelName } = await getSync<{ apiKey?: string; modelName?: string }>(['apiKey', 'modelName']);
  if (apiKey && modelName) return;
  if (state.getConversationHistory().length > 0) return;

  const welcome = els.chatArea.querySelector('.welcome-msg');
  if (!welcome) return;
  welcome.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'onboarding-card';

  const title = document.createElement('div');
  title.className = 'onboarding-title';
  title.textContent = t('onboarding.needConfig');

  const hint = document.createElement('div');
  hint.className = 'onboarding-hint';
  hint.textContent = t('onboarding.hint');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'onboarding-settings-btn';
  btn.textContent = t('action.openSettings');
  btn.addEventListener('click', () => { openOptionsPage(); });

  card.append(title, hint, btn);
  welcome.appendChild(card);
}

init();
