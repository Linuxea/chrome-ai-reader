// side_panel.js — 侧边栏交互逻辑

const chatArea = document.getElementById('chatArea');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');
const newChatBtn = document.getElementById('newChatBtn');
const exportBtn = document.getElementById('exportBtn');
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historyBackBtn = document.getElementById('historyBackBtn');
const historyList = document.getElementById('historyList');
const actionBtns = document.querySelectorAll('.action-btn');
// themeToggleBtn declared in theme.js
const quotePreview = document.getElementById('quotePreview');
const quoteText = document.getElementById('quoteText');
const quoteClose = document.getElementById('quoteClose');

let pageContent = '';
let pageExcerpt = '';
let pageTitle = '';
let conversationHistory = [];
let isGenerating = false;
let customSystemPrompt = '';
let currentChatId = null;
let selectedText = '';
let activeTabId = null;

const TRUNCATE_LIMITS = {
  CONTEXT: 64000,
  QUOTE: 64000,
};

function safeTruncate(text, maxLen, suffix) {
  if (!text) return text;
  const chars = [...text];
  if (chars.length <= maxLen) return text;
  const truncSuffix = suffix || t('ai.truncated');

  const truncated = chars.slice(0, maxLen).join('');
  const lookback = Math.min(200, maxLen);
  const tail = truncated.slice(-lookback);
  const lastBreak = tail.lastIndexOf('\n');
  if (lastBreak > 0) {
    return truncated.slice(0, truncated.length - lookback + lastBreak + 1) + truncSuffix;
  }
  return truncated + truncSuffix;
}

marked.setOptions({
  breaks: true,
  gfm: true
});

chrome.storage.sync.get(['systemPrompt'], (data) => {
  if (data.systemPrompt) {
    customSystemPrompt = data.systemPrompt;
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) activeTabId = tabs[0].id;
});

// === 夜间模式 ===（已拆分至 theme.js）

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.systemPrompt) {
    customSystemPrompt = changes.systemPrompt.newValue || '';
  }
});

// === 事件绑定 ===

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

newChatBtn.addEventListener('click', () => {
  if (isGenerating) return;
  if (ttsPlaying) stopTTS();
  saveCurrentChat();
  removeSuggestQuestions();
  pageContent = '';
  pageExcerpt = '';
  pageTitle = '';
  conversationHistory = [];
  currentChatId = null;
  updateQuotePreview('');
  clearImagePreviews();
  chatArea.innerHTML = `<div class="welcome-msg"><p>${t('sidebar.welcome')}</p></div>`;
});

exportBtn.addEventListener('click', () => {
  const messages = getDisplayMessages();
  if (messages.length === 0) return;
  exportChatAsMarkdown({
    title: generateTitle(messages),
    messages,
    conversationHistory,
    pageTitle
  });
});

historyBtn.addEventListener('click', () => {
  renderHistoryList();
  historyPanel.classList.remove('hidden');
});

historyBackBtn.addEventListener('click', () => {
  historyPanel.classList.add('hidden');
});

actionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    handleQuickAction(action);
  });
});

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (e) => {
  if (commandPopupOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        commandSelectedIndex = (commandSelectedIndex + 1) % filtered.length;
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        commandSelectedIndex = (commandSelectedIndex - 1 + filtered.length) % filtered.length;
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        executeQuickCommand(filtered[commandSelectedIndex]);
      } else {
        hideCommandPopup();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideCommandPopup();
      return;
    }
  } else {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
});

userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';

  const value = userInput.value;
  if (value.startsWith('/')) {
    updateCommandPopup(value);
  } else if (commandPopupOpen) {
    hideCommandPopup();
  }
});

// === 快捷指令弹出列表 ===（已拆分至 quick-commands.js）

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'selectionChanged') {
    if (activeTabId && msg.tabId && msg.tabId !== activeTabId) return;
    updateQuotePreview(msg.text);
  }
});

function updateQuotePreview(text) {
  selectedText = text;
  if (text) {
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    quoteText.textContent = truncated;
    quotePreview.classList.remove('hidden');
  } else {
    quoteText.textContent = '';
    quotePreview.classList.add('hidden');
  }
}

quoteClose.addEventListener('click', () => {
  updateQuotePreview('');
});

// === 图片上传 + OCR ===（已拆分至 ocr.js）

// === 历史对话管理 ===（已拆分至 chat-history.js）

// === 核心功能 ===（已拆分至 ai-chat.js）

// === UI 辅助函数 ===（已拆分至 ui-helpers.js）

// === TTS 语音合成 ===（已拆分至 tts-streaming.js）

// === 推荐追问 ===（已拆分至 suggest-questions.js）

// === 模型状态栏 ===（已拆分至 model-status.js）

// === 初始化语言 ===
loadLanguage();
