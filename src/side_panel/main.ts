import { loadLanguage } from '../shared/i18n.js';
import { t } from '../shared/i18n.js';
import { initState } from './state';
import * as state from './state';
import { on, EVENTS } from './events';
import { initDOMHelpers, appendMessage } from './ui/dom-helpers';
import { initTheme } from './ui/theme';
import { initModelStatus } from './ui/model-status';
import { initTTS, isTTSPlaying, stopTTS, addTTSButton } from './services/tts/index.js';
import { initImages, clearImagePreviews, addImageDataUri, hasPendingImages } from './services/images.js';
import { captureVisibleTab, captureFullPage } from './services/screenshot';
import { readSettings } from '../platform/settings';
import { openOptionsPage } from '../platform/messaging';
import { initAIChat } from './services/ai-chat';
import { submit, retryMessage, editMessage } from './services/message-sender';
import { initComposer } from './services/composer';
import { initChatHistory, saveCurrentChat } from './features/chat-history';
import { initQuickCommands, isCommandPopupOpen, hideCommandPopup, getFilteredCommands, renderCommandPopup, executeQuickCommand, getCommandSelectedIndex, setCommandSelectedIndex } from './features/quick-commands';
import { initSuggestQuestions, removeSuggestQuestions, generateSuggestions } from './features/suggest-questions';
import { renderOutlineFromJSON, outlineToMarkdown } from './features/outline';
import { initImageInput } from './features/image-input';
import { initPodcast, handlePodcastClick } from './features/podcast/index.js';
import { initMiniPlayer } from './features/podcast/mini-player.js';
import { initRelatedPages, renderRelatedPages } from './features/related-pages';
import { initAnnotation } from './features/annotation';
import { initCitations } from './features/citations';
import { initTabContext } from './features/tab-context';
import { initReadingSearch } from './features/reading-search';
import { initNotes } from './features/notes';
import { initPanelActions } from './features/panel-actions';
import { bindGlobalEvents } from './shell/global-events';
import type { UIElements } from './shell/types';
import { updateQuotePreview } from './ui/quote-preview';
import { handleLoadChat, resetUIForTabSwitch } from './shell/tab-switch-handler';
import type { ChatMessage } from '../shared/types';

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

  initDOMHelpers({ chatArea: els.chatArea, actionBtns, sendBtn, userInput: els.userInput, hasAttachments: hasPendingImages });
  initTheme();
  initModelStatus();

  initTTS({ chatArea: els.chatArea });
  initImages();
  initComposer({ userInput: els.userInput });

  // 截图按钮：模型默认支持多模态，截图直接作为图片附件发给模型
  const visionCaptureBtn = document.getElementById('visionCaptureBtn')!;
  const fullPageCaptureBtn = document.getElementById('fullPageCaptureBtn') as HTMLButtonElement;

  visionCaptureBtn.addEventListener('click', async () => {
    try {
      const dataUri = await captureVisibleTab();
      const name = t('screenshot.defaultName', { time: new Date().toLocaleString() });
      addImageDataUri(dataUri, name);
    } catch (e) {
      appendMessage('error', t('error.screenshotFailed') + (e instanceof Error ? `：${e.message}` : ''));
    }
  });

  // 整页截屏：由上至下 截屏→滚动→截屏…直到触底或达段数上限；结束后恢复原滚动位置
  let fullPageBusy = false;
  fullPageCaptureBtn.addEventListener('click', async () => {
    if (fullPageBusy) return;
    fullPageBusy = true;
    const prevTitle = fullPageCaptureBtn.title;
    visionCaptureBtn.setAttribute('disabled', '');
    fullPageCaptureBtn.setAttribute('disabled', '');
    try {
      const { dataUris, error } = await captureFullPage((done, total) => {
        fullPageCaptureBtn.title = t('screenshot.fullPageProgress', { done, total });
      });
      const time = new Date().toLocaleString();
      for (let i = 0; i < dataUris.length; i++) {
        const name = t('screenshot.fullPageName', { n: i + 1, total: dataUris.length, time });
        addImageDataUri(dataUris[i], name);
      }
      if (error || dataUris.length === 0) {
        appendMessage('error', t('error.screenshotFailed') + (error ? `：${error}` : ''));
      }
    } catch (e) {
      appendMessage('error', t('error.screenshotFailed') + (e instanceof Error ? `：${e.message}` : ''));
    } finally {
      fullPageBusy = false;
      visionCaptureBtn.removeAttribute('disabled');
      fullPageCaptureBtn.removeAttribute('disabled');
      fullPageCaptureBtn.title = prevTitle;
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
  initQuickCommands({ userInput: els.userInput, commandPopup, onSubmit: submit });
  initSuggestQuestions({ chatArea: els.chatArea });
  initImageInput({ userInput: els.userInput });
  initPodcast({ chatArea: els.chatArea });
  initMiniPlayer();
  initRelatedPages({ chatArea: els.chatArea });
  initCitations({ chatArea: els.chatArea });
  initReadingSearch(document.getElementById('relatedPagesPanel'));
  initNotes({
    button: document.getElementById('notesBtn')!,
    panel: document.getElementById('notesPanel')!,
    list: document.getElementById('notesList')!,
    backBtn: document.getElementById('notesBackBtn')!,
    exportBtn: document.getElementById('notesExportBtn')!,
    highlightBtn: document.getElementById('quoteHighlight'),
    quoteEls: { quoteText: els.quoteText, quotePreview: els.quotePreview },
  });
  initTabContext({
    button: document.getElementById('tabContextBtn')!,
    picker: document.getElementById('tabPicker')!,
    chipBar: document.getElementById('tabChipBar')!,
  });
  const annotationBtn = document.querySelector<HTMLButtonElement>('[data-action="annotation"]');
  if (annotationBtn) {
    initAnnotation({
      button: annotationBtn,
      userInput: els.userInput,
      quoteText: els.quoteText,
      quotePreview: els.quotePreview,
    });
  }

  on(EVENTS.RETRY, ({ wrapper, rawText, rawDisplay, rawQuote, msgId }) => { retryMessage(wrapper, rawText, rawDisplay, rawQuote, msgId); });
  on(EVENTS.EDIT, ({ wrapper, originalRawText, editedText, rawQuote, msgId }) => { editMessage(wrapper, originalRawText, editedText, rawQuote, msgId); });
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
  // After state + quick actions are ready: run a context-menu / shortcut action.
  initPanelActions({ quoteEls: { quoteText: els.quoteText, quotePreview: els.quotePreview }, userInput: els.userInput });

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
  const { apiKey, modelName } = await readSettings(['apiKey', 'modelName']);
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
