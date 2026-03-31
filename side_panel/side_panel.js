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
const themeToggleBtn = document.getElementById('themeToggleBtn');
const quotePreview = document.getElementById('quotePreview');
const quoteText = document.getElementById('quoteText');
const quoteClose = document.getElementById('quoteClose');

const imageUploadBtn = document.getElementById('imageUploadBtn');
const imageFileInput = document.getElementById('imageFileInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');

let pageContent = '';
let pageExcerpt = '';
let pageTitle = '';
let conversationHistory = [];
let isGenerating = false;
let customSystemPrompt = '';
let currentChatId = null;
let selectedText = '';

let ocrResults = [];
let ocrRunning = 0;
let imageIndex = 0;
let activeTabId = null;

let suggestQuestionsEnabled = true;
let suggestPort = null;

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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

chrome.storage.sync.get(['suggestQuestions'], (data) => {
  suggestQuestionsEnabled = data.suggestQuestions !== false;
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) activeTabId = tabs[0].id;
});

// === 夜间模式 ===

function applyTheme(dark, themeName) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  const moonIcon = themeToggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = themeToggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}

chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
  applyTheme(!!data.darkMode, data.themeName || 'sujian');
});

themeToggleBtn.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newDark = !isDark;
  const currentTheme = document.documentElement.getAttribute('data-theme-name') || 'sujian';
  applyTheme(newDark, currentTheme);
  chrome.storage.sync.set({ darkMode: newDark });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    const darkMode = changes.darkMode;
    const themeName = changes.themeName;
    if (darkMode || themeName) {
      const isDark = darkMode ? !!darkMode.newValue : document.documentElement.getAttribute('data-theme') === 'dark';
      const currentTheme = themeName ? themeName.newValue : document.documentElement.getAttribute('data-theme-name') || 'sujian';
      applyTheme(isDark, currentTheme);
    }
    if (changes.systemPrompt) {
      customSystemPrompt = changes.systemPrompt.newValue || '';
    }
    if (changes.suggestQuestions) {
      suggestQuestionsEnabled = changes.suggestQuestions.newValue !== false;
    }
    if (changes.modelName) {
      updateModelStatusBar(changes.modelName.newValue);
    }
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

// === 图片上传 + OCR ===

imageUploadBtn.addEventListener('click', () => {
  imageFileInput.click();
});

imageFileInput.addEventListener('change', () => {
  const files = Array.from(imageFileInput.files);
  if (files.length === 0) return;
  imageFileInput.value = '';

  imagePreviewBar.classList.remove('hidden');

  files.forEach(file => {
    imageIndex++;
    const idx = imageIndex;
    const reader = new FileReader();

    reader.onload = (e) => {
      const dataUri = e.target.result;
      addImagePreview(idx, file.name, dataUri);
      runOCR(idx, file.name, dataUri);
    };

    reader.readAsDataURL(file);
  });
});

function addImagePreview(index, fileName, dataUri) {
  const item = document.createElement('div');
  item.className = 'image-preview-item';
  item.dataset.index = index;

  item.innerHTML = `
    <img src="${dataUri}" class="image-thumb" alt="${escapeHtml(fileName)}">
    <span class="image-status loading"></span>
    <button class="image-remove" title="${t('sidebar.remove')}">×</button>
  `;

  item.querySelector('.image-remove').addEventListener('click', () => {
    item.remove();
    ocrResults = ocrResults.filter(r => r.index !== index);
    if (imagePreviewBar.children.length === 0) {
      imagePreviewBar.classList.add('hidden');
    }
  });

  imagePreviewBar.appendChild(item);
}

async function runOCR(index, fileName, dataUri) {
  ocrRunning++;
  const item = imagePreviewBar.querySelector(`[data-index="${index}"]`);
  const statusEl = item?.querySelector('.image-status');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'ocrParse',
      file: dataUri
    });

    if (response && response.success) {
      const text = extractOcrText(response.data);
      ocrResults.push({ index, fileName, text });
      if (statusEl) statusEl.className = 'image-status done';
      if (item) item.classList.add('done');
    } else {
      if (statusEl) statusEl.className = 'image-status error';
      if (item) item.classList.add('error');
    }
  } catch (e) {
    if (statusEl) statusEl.className = 'image-status error';
    if (item) item.classList.add('error');
  } finally {
    ocrRunning--;
  }
}

function extractOcrText(data) {
  if (!data) return '';
  if (data.md_results) return data.md_results;
  if (data.content_list && Array.isArray(data.content_list)) {
    return data.content_list
      .map(item => item.text || '')
      .filter(t => t.trim())
      .join('\n');
  }
  if (data.markdown) return data.markdown;
  if (data.text) return data.text;
  return '';
}

function collectImageDataUris() {
  const items = imagePreviewBar.querySelectorAll('.image-preview-item:not(.error)');
  const uris = [];
  items.forEach(item => {
    const img = item.querySelector('.image-thumb');
    if (img && img.src) uris.push({ index: parseInt(item.dataset.index), uri: img.src });
  });
  uris.sort((a, b) => a.index - b.index);
  return uris.map(u => u.uri);
}

function clearImagePreviews() {
  ocrResults = [];
  ocrRunning = 0;
  imageIndex = 0;
  imagePreviewBar.innerHTML = '';
  imagePreviewBar.classList.add('hidden');
}

function buildOcrContext() {
  if (ocrResults.length === 0) return '';
  const sorted = [...ocrResults].sort((a, b) => a.index - b.index);
  return sorted.map((r, i) => {
    return t('ai.ocrContext', { n: i + 1 }) + r.text;
  }).join('\n\n');
}

// === 历史对话管理 ===（已拆分至 chat-history.js）

// === 核心功能 ===

async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
  if (!tab) throw new Error(t('error.noTab'));

  const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
  if (!response?.success) {
    throw new Error(response?.error || t('error.extractFailed'));
  }

  pageContent = response.data.textContent;
  pageExcerpt = response.data.excerpt;
  pageTitle = response.data.title;

  return response.data;
}

async function handleQuickAction(action) {
  if (isGenerating) return;

  if (action === 'outline') {
    generateOutline();
    return;
  }

  if (ocrRunning > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  const errorItems = imagePreviewBar.querySelectorAll('.image-preview-item.error');
  if (errorItems.length > 0) {
    appendMessage('error', t('error.ocrPartialFail'));
    return;
  }

  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts = {
    summarize: hasSelection ? t('prompt.summarize.quote') : t('prompt.summarize.full'),
    translate: hasSelection ? t('prompt.translate.quote') : t('prompt.translate.full'),
    keyInfo: hasSelection ? t('prompt.keyInfo.quote') : t('prompt.keyInfo.full')
  };

  const actionNames = {
    summarize: t('action.summarize'),
    translate: t('action.translate'),
    keyInfo: t('action.keyInfo')
  };

  const ocrContext = buildOcrContext();
  const ocrCount = ocrResults.length;
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await sendToAI(actionPrompts[action], actionNames[action], undefined, ocrContext, ocrCount, imageUris);
}

async function sendToAI(text, displayText, retryQuote, ocrContext, ocrCount, imageUris) {
  removeSuggestQuestions();
  const quoteForContext = retryQuote || selectedText;

  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    const userMsgEl = appendMessageWithQuote(truncated, displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawQuote = quoteForContext;
    userMsgEl.dataset.rawDisplay = displayText;
    updateQuotePreview('');
  } else {
    const userMsgEl = appendMessage('user', displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawDisplay = displayText;
  }

  try {
    await extractPageContent();

    const messages = [];
    if (pageContent) {
      const context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);

      const systemContent = t('prompt.default', { title: pageTitle, content: context });
      messages.push({
        role: 'system',
        content: systemContent
      });

      if (customSystemPrompt) {
        messages.push({ role: 'system', content: customSystemPrompt });
      }
    }

    messages.push(...conversationHistory);

    let historyContent = text;
    let apiContent = text;

    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
      const withQuote = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
      historyContent = withQuote;
      apiContent = withQuote;
    }

    conversationHistory.push({ role: 'user', content: historyContent });

    if (ocrContext) {
      apiContent = apiContent + '\n\n' + ocrContext;
    }
    messages.push({ role: 'user', content: apiContent });

    await callAI(messages);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
  }
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isGenerating) return;

  if (ocrRunning > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  const errorItems = imagePreviewBar.querySelectorAll('.image-preview-item.error');
  if (errorItems.length > 0) {
    appendMessage('error', t('error.ocrPartialFail'));
    return;
  }

  userInput.value = '';
  userInput.style.height = 'auto';

  const ocrContext = buildOcrContext();
  const ocrCount = ocrResults.length;
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await sendToAI(text, text, undefined, ocrContext, ocrCount, imageUris);
}

async function retryMessage(wrapper, rawText, rawDisplay, rawQuote) {
  if (isGenerating) return;

  if (ttsPlaying) stopTTS();
  removeSuggestQuestions();

  const children = [...chatArea.children];
  let found = false;
  for (const child of children) {
    if (child === wrapper) found = true;
    if (found) child.remove();
  }

  const userContent = rawQuote
    ? t('ai.quotePrefix') + '\n\n' + safeTruncate(rawQuote, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated')) + '\n\n' + rawText
    : rawText;
  const idx = conversationHistory.findLastIndex(m => m.role === 'user' && m.content === userContent);
  if (idx !== -1) {
    conversationHistory.splice(idx);
  }

  await sendToAI(rawText, rawDisplay, rawQuote);
}

async function callAI(messages) {
  if (ttsPlaying) stopTTS();

  isGenerating = true;
  setButtonsDisabled(true);

  if (ttsAutoPlayEnabled) {
    initTTSPlayback();
  }

  const msgEl = appendMessage('ai', '');
  const typingEl = addTypingIndicator(msgEl);
  let fullText = '';
  let thinkingText = '';
  let thinkingEl = null;
  let thinkingContentEl = null;
  let contentEl = null;

  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({
    type: 'chat',
    messages: messages
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'thinking') {
      thinkingText += msg.content;
      removeTypingIndicator(typingEl);

      if (!thinkingEl) {
        thinkingEl = document.createElement('details');
        thinkingEl.className = 'thinking-block';
        thinkingEl.open = true;
        const summary = document.createElement('summary');
        summary.className = 'thinking-summary';
        summary.textContent = t('ai.thinking');
        thinkingEl.appendChild(summary);
        thinkingContentEl = document.createElement('div');
        thinkingContentEl.className = 'thinking-content';
        thinkingEl.appendChild(thinkingContentEl);
        msgEl.appendChild(thinkingEl);
      }

      thinkingContentEl.innerHTML = marked.parse(thinkingText);
      smartScrollToBottom();
    } else if (msg.type === 'chunk') {
      if (thinkingEl) {
        thinkingEl.open = false;
        thinkingEl = null;
      }

      fullText += msg.content;
      removeTypingIndicator(typingEl);

      if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'thinking-response-content';
        msgEl.appendChild(contentEl);
      }

      contentEl.innerHTML = marked.parse(fullText);
      smartScrollToBottom();
      if (ttsAutoPlayEnabled) {
        ttsAppendChunk(msg.content);
      }
    } else if (msg.type === 'done') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      conversationHistory.push({ role: 'assistant', content: fullText });
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
      addTTSButton(msgEl);
      initTTSAutoPlay(msgEl);
      saveCurrentChat();
      generateSuggestions(msgEl, conversationHistory);
    } else if (msg.type === 'error') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      const errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || '');
      msgEl.innerHTML = `<span style="color:var(--error-text)">${errorText}</span>`;
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
    }
  });
}

// === UI 辅助函数 ===（已拆分至 ui-helpers.js）

// === TTS 语音合成 ===（已拆分至 tts-streaming.js）

// === 推荐追问 ===

function removeSuggestQuestions() {
  if (suggestPort) {
    try { suggestPort.disconnect(); } catch {}
    suggestPort = null;
  }
  const el = chatArea.querySelector('.suggest-questions, .suggest-loading');
  if (el) el.remove();
}

function generateSuggestions(msgEl, history) {
  if (!suggestQuestionsEnabled) return;

  const loadingEl = document.createElement('div');
  loadingEl.className = 'suggest-loading';
  loadingEl.innerHTML = `
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
  `;
  msgEl.after(loadingEl);

  const recentHistory = history.slice(-4);
  const userMessages = recentHistory.filter(m => m.role === 'user');
  const assistantMessages = recentHistory.filter(m => m.role === 'assistant');

  let userContent = '';
  const lastUser = userMessages[userMessages.length - 1];
  if (lastUser) userContent += t('prompt.suggestUser') + lastUser.content + '\n\n';

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const truncated = lastAssistant.content.length > 2000
      ? lastAssistant.content.slice(0, 2000) + '...'
      : lastAssistant.content;
    userContent += t('prompt.suggestAI') + truncated;
  }

  const messages = [
    {
      role: 'system',
      content: t('prompt.suggest')
    },
    { role: 'user', content: userContent }
  ];

  const port = chrome.runtime.connect({ name: 'suggest-questions' });
  suggestPort = port;

  port.onDisconnect.addListener(() => {
    suggestPort = null;
    if (loadingEl.parentNode) loadingEl.remove();
  });

  let fullText = '';

  port.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      fullText += msg.content;
    } else if (msg.type === 'done') {
      port.disconnect();
      suggestPort = null;
      if (!msgEl.parentNode) return;
      const questions = fullText
        .split('\n')
        .map(q => q.replace(/^[\d]+[.、)\s]*/, '').trim())
        .filter(q => q.length > 0)
        .slice(0, 3);

      if (loadingEl.parentNode) loadingEl.remove();

      if (questions.length === 0) return;

      const suggestEl = document.createElement('div');
      suggestEl.className = 'suggest-questions';

      questions.forEach(q => {
        const item = document.createElement('button');
        item.className = 'suggest-item';
        item.textContent = q;
        item.addEventListener('click', () => {
          suggestEl.remove();
          userInput.value = q;
          sendMessage();
        });
        suggestEl.appendChild(item);
      });

      msgEl.after(suggestEl);
      smartScrollToBottom();
    } else if (msg.type === 'error') {
      port.disconnect();
      suggestPort = null;
      if (loadingEl.parentNode) loadingEl.remove();
    }
  });

  port.postMessage({ type: 'suggest', messages });
}

// === 模型状态栏 ===

const modelStatusBar = document.getElementById('modelStatusBar');

function updateModelStatusBar(name) {
  modelStatusBar.textContent = t('sidebar.modelStatus') + (name || 'deepseek-chat');
}

chrome.storage.sync.get(['modelName'], (data) => {
  updateModelStatusBar(data.modelName);
});

// === 初始化语言 ===
loadLanguage();
