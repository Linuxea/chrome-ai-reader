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

// 当前页面的内容上下文
let pageContent = '';
let pageExcerpt = '';
let pageTitle = '';
// 对话历史
let conversationHistory = [];
// 是否正在生成回复
let isGenerating = false;
// 自定义 system prompt
let customSystemPrompt = '';
// 当前聊天 ID（null 表示新会话）
let currentChatId = null;
// 选中的引用文本
let selectedText = '';
// 当前关联的标签页 ID
let activeTabId = null;

// 快捷指令状态（由 quick-commands.js 管理）
// commandPopupOpen, commandSelectedIndex, quickCommands 等在 quick-commands.js 中定义

// 推荐追问状态
let suggestQuestionsEnabled = true;
let suggestPort = null;

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 内容截断限制（字符数，基于 DeepSeek 128K token 上下文窗口）
// 128K tokens ≈ 96K~128K 中文字符，截断值需留出对话历史和回复空间
const TRUNCATE_LIMITS = {
  CONTEXT: 64000,
  QUOTE: 64000,
};

/**
 * 安全截断文本，按 code point 切割并在段落/句子边界处断开
 * 避免在 UTF-16 代理对中间截断（如 emoji、罕见 CJK 字符）
 */
function safeTruncate(text, maxLen, suffix = '\n\n[内容过长，已截断]') {
  if (!text) return text;
  const chars = [...text]; // 按 code point 展开，避免拆开代理对
  if (chars.length <= maxLen) return text;

  const truncated = chars.slice(0, maxLen).join('');
  // 在截断点附近找最近的换行符作为自然断点（回溯 200 字符）
  const lookback = Math.min(200, maxLen);
  const tail = truncated.slice(-lookback);
  const lastBreak = tail.lastIndexOf('\n');
  if (lastBreak > 0) {
    return truncated.slice(0, truncated.length - lookback + lastBreak + 1) + suffix;
  }
  return truncated + suffix;
}

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true
});

// 加载自定义 system prompt
chrome.storage.sync.get(['systemPrompt'], (data) => {
  if (data.systemPrompt) {
    customSystemPrompt = data.systemPrompt;
  }
});

// 加载推荐追问开关
chrome.storage.sync.get(['suggestQuestions'], (data) => {
  suggestQuestionsEnabled = data.suggestQuestions !== false;
});

// 初始化：获取当前标签页 ID
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

// 加载主题偏好
chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
  applyTheme(!!data.darkMode, data.themeName || 'sujian');
});

// 切换按钮
themeToggleBtn.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newDark = !isDark;
  applyTheme(newDark);
  chrome.storage.sync.set({ darkMode: newDark });
});

// 监听其他页面的主题变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    const darkMode = changes.darkMode;
    const themeName = changes.themeName;
    if (darkMode || themeName) {
      const isDark = darkMode ? !!darkMode.newValue : document.documentElement.getAttribute('data-theme') === 'dark';
      const currentTheme = themeName ? themeName.newValue : document.documentElement.getAttribute('data-theme-name') || 'sujian';
      applyTheme(isDark, currentTheme);
    }
  }
});

// === 事件绑定 ===

// 设置按钮
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 新建聊天
newChatBtn.addEventListener('click', () => {
  if (isGenerating) return;
  // 停止 TTS
  if (ttsPlaying) stopTTS();
  // 先保存当前会话
  saveCurrentChat();
  // 重置状态
  removeSuggestQuestions();
  pageContent = '';
  pageExcerpt = '';
  pageTitle = '';
  conversationHistory = [];
  currentChatId = null;
  updateQuotePreview('');
  chatArea.innerHTML = '<div class="welcome-msg"><p>打开任意网页，点击上方按钮或输入问题开始使用。</p></div>';
});

// 导出当前聊天
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

// 历史面板
historyBtn.addEventListener('click', () => {
  renderHistoryList();
  historyPanel.classList.remove('hidden');
});

historyBackBtn.addEventListener('click', () => {
  historyPanel.classList.add('hidden');
});

// 快捷操作按钮
actionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    handleQuickAction(action);
  });
});

// 发送按钮
sendBtn.addEventListener('click', sendMessage);

// 输入框：Enter 发送，Shift+Enter 换行
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

// 输入框自动调整高度 + 快捷指令检测
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

// 监听选区变化消息（经由 service_worker 中转）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'selectionChanged') {
    // 只处理当前关联 tab 的消息
    if (activeTabId && msg.tabId && msg.tabId !== activeTabId) return;
    updateQuotePreview(msg.text);
  }
});

// 更新引用预览 UI
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

// 清除引用按钮
quoteClose.addEventListener('click', () => {
  updateQuotePreview('');
});

// === 历史对话管理 ===（已拆分至 chat-history.js）

// === 核心功能 ===

// 提取当前页面内容
async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
  if (!tab) throw new Error('无法获取当前标签页');

  const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
  if (!response?.success) {
    throw new Error(response?.error || '页面内容提取失败');
  }

  pageContent = response.data.textContent;
  pageExcerpt = response.data.excerpt;
  pageTitle = response.data.title;

  return response.data;
}

// 快捷操作处理
async function handleQuickAction(action) {
  if (isGenerating) return;

  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts = {
    summarize: hasSelection
      ? '请总结用户引用的这段内容。要求：\n1. 用 3-5 个要点概括核心内容\n2. 保持客观，不添加原文没有的信息\n3. 语言简洁明了'
      : '请总结这篇网页内容。要求：\n1. 用 3-5 个要点概括核心内容\n2. 保持客观，不添加原文没有的信息\n3. 语言简洁明了',
    translate: hasSelection
      ? '请将用户引用的这段内容翻译为中文。要求：\n1. 准确传达原文含义\n2. 语言通顺自然\n3. 专业术语保留英文并附上中文解释'
      : '请将这篇网页内容翻译为中文。要求：\n1. 准确传达原文含义\n2. 语言通顺自然\n3. 专业术语保留英文并附上中文解释',
    keyInfo: hasSelection
      ? '请提取用户引用的这段内容的关键信息。要求：\n1. 列出所有重要的事实、数据、观点\n2. 按重要性排序\n3. 每条信息简洁明了'
      : '请提取这篇网页内容的关键信息。要求：\n1. 列出所有重要的事实、数据、观点\n2. 按重要性排序\n3. 每条信息简洁明了'
  };

  const actionNames = {
    summarize: '总结',
    translate: '翻译',
    keyInfo: '提取关键信息'
  };

  await sendToAI(actionPrompts[action], actionNames[action]);
}

// 核心发送逻辑（统一入口）
// retryQuote: 重试时传入的引用文本，绕过 selectedText
async function sendToAI(text, displayText, retryQuote) {
  removeSuggestQuestions();
  const quoteForContext = retryQuote || selectedText;

  // 显示用户消息
  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    const userMsgEl = appendMessageWithQuote(truncated, displayText);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawQuote = quoteForContext;
    userMsgEl.dataset.rawDisplay = displayText;
    updateQuotePreview('');
  } else {
    const userMsgEl = appendMessage('user', displayText);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawDisplay = displayText;
  }

  try {
    // 每次发送消息都重新提取页面内容，确保获取最新内容
    await extractPageContent();

    // 构建消息列表（带页面上下文）
    const messages = [];
    if (pageContent) {
      const context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);

      messages.push({
        role: 'system',
        content: `你是一个 AI 阅读助手。用户正在阅读一篇网页文章，以下是文章内容，请基于这些内容回答用户的问题。

文章标题：${pageTitle}

文章内容：
${context}`
      });

      if (customSystemPrompt) {
        messages.push({ role: 'system', content: customSystemPrompt });
      }
    }

    // 加入历史对话
    messages.push(...conversationHistory);

    // 构建当前用户消息（引用内容合并到用户消息中）
    let userContent = text;
    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, '\n\n[引用内容过长，已截断]');
      userContent = `以下是用户从页面中引用的内容：\n\n${quote}\n\n${text}`;
    }
    conversationHistory.push({ role: 'user', content: userContent });
    messages.push({ role: 'user', content: userContent });

    await callAI(messages);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
  }
}

// 自由问答发送
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isGenerating) return;

  userInput.value = '';
  userInput.style.height = 'auto';
  await sendToAI(text, text);
}

// 重试某条用户消息
async function retryMessage(wrapper, rawText, rawDisplay, rawQuote) {
  if (isGenerating) return;

  // 停止 TTS
  if (ttsPlaying) stopTTS();
  removeSuggestQuestions();

  // 移除该 wrapper 及其后的所有 chatArea 子元素
  const children = [...chatArea.children];
  let found = false;
  for (const child of children) {
    if (child === wrapper) found = true;
    if (found) child.remove();
  }

  // 截断 conversationHistory：移除该用户消息及其后的所有条目
  const userContent = rawQuote
    ? `以下是用户从页面中引用的内容：\n\n${safeTruncate(rawQuote, TRUNCATE_LIMITS.QUOTE, '\n\n[引用内容过长，已截断]')}\n\n${rawText}`
    : rawText;
  const idx = conversationHistory.findLastIndex(m => m.role === 'user' && m.content === userContent);
  if (idx !== -1) {
    conversationHistory.splice(idx);
  }

  // 重新发送（传入原始引用文本）
  await sendToAI(rawText, rawDisplay, rawQuote);
}

// 调用 AI（统一入口）
async function callAI(messages) {
  // 停止正在播放的 TTS
  if (ttsPlaying) stopTTS();

  isGenerating = true;
  setButtonsDisabled(true);

  // 如果自动播放开启，初始化 TTS 播放
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
        summary.textContent = '思考过程';
        thinkingEl.appendChild(summary);
        thinkingContentEl = document.createElement('div');
        thinkingContentEl.className = 'thinking-content';
        thinkingEl.appendChild(thinkingContentEl);
        msgEl.appendChild(thinkingEl);
      }

      thinkingContentEl.innerHTML = marked.parse(thinkingText);
      smartScrollToBottom();
    } else if (msg.type === 'chunk') {
      // 思考结束后折叠思考区块
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
      // 流式 TTS：追加文本缓冲
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
      // 添加 TTS 按钮
      addTTSButton(msgEl);
      // 流式 TTS：flush 剩余文本
      initTTSAutoPlay(msgEl);
      // 自动保存
      saveCurrentChat();
      // 生成推荐追问
      generateSuggestions(msgEl, conversationHistory);
    } else if (msg.type === 'error') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      msgEl.innerHTML = `<span style="color:var(--error-text)">${msg.error}</span>`;
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
    }
  });
}

// === UI 辅助函数 ===（已拆分至 ui-helpers.js）

// === TTS 语音合成 ===（已拆分至 tts-streaming.js）

// === 推荐追问 ===

// 移除当前显示的推荐问题区域
function removeSuggestQuestions() {
  if (suggestPort) {
    try { suggestPort.disconnect(); } catch {}
    suggestPort = null;
  }
  const el = chatArea.querySelector('.suggest-questions, .suggest-loading');
  if (el) el.remove();
}

// 生成推荐追问
function generateSuggestions(msgEl, history) {
  if (!suggestQuestionsEnabled) return;

  // 显示骨架加载态
  const loadingEl = document.createElement('div');
  loadingEl.className = 'suggest-loading';
  loadingEl.innerHTML = `
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
    <div class="suggest-loading-bar"></div>
  `;
  msgEl.after(loadingEl);

  // 构建发给 API 的消息（取最近 2 轮对话）
  const recentHistory = history.slice(-4); // 2 轮 = 4 条消息 (user, assistant, user, assistant)
  const userMessages = recentHistory.filter(m => m.role === 'user');
  const assistantMessages = recentHistory.filter(m => m.role === 'assistant');

  let userContent = '';
  const lastUser = userMessages[userMessages.length - 1];
  if (lastUser) userContent += '用户问题：' + lastUser.content + '\n\n';

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const truncated = lastAssistant.content.length > 2000
      ? lastAssistant.content.slice(0, 2000) + '...'
      : lastAssistant.content;
    userContent += 'AI 回复：' + truncated;
  }

  const messages = [
    {
      role: 'system',
      content: '你是一个阅读助手。基于对话历史，生成 3 个有深度的后续问题，帮助用户更深入地理解文章内容。每行一个问题，不要编号，不要额外解释。'
    },
    { role: 'user', content: userContent }
  ];

  const port = chrome.runtime.connect({ name: 'suggest-questions' });
  suggestPort = port;

  port.onDisconnect.addListener(() => {
    suggestPort = null;
    // port 断开时清理骨架
    if (loadingEl.parentNode) loadingEl.remove();
  });

  let fullText = '';

  port.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      fullText += msg.content;
    } else if (msg.type === 'done') {
      port.disconnect();
      suggestPort = null;
      // 如果 msgEl 已不在 DOM 中（用户新建了聊天），跳过渲染
      if (!msgEl.parentNode) return;
      // 解析问题列表
      const questions = fullText
        .split('\n')
        .map(q => q.replace(/^[\d]+[.、)\s]*/, '').trim()) // 移除可能的编号
        .filter(q => q.length > 0)
        .slice(0, 3);

      // 移除骨架
      if (loadingEl.parentNode) loadingEl.remove();

      if (questions.length === 0) return;

      // 渲染推荐问题
      const suggestEl = document.createElement('div');
      suggestEl.className = 'suggest-questions';

      questions.forEach(q => {
        const item = document.createElement('button');
        item.className = 'suggest-item';
        item.textContent = q;
        item.addEventListener('click', () => {
          // 移除推荐区域
          suggestEl.remove();
          // 填入并发送
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
      // 静默失败，移除骨架
      if (loadingEl.parentNode) loadingEl.remove();
    }
  });

  port.postMessage({ type: 'suggest', messages });
}

// === 模型状态栏 ===

const modelStatusBar = document.getElementById('modelStatusBar');

function updateModelStatusBar(name) {
  modelStatusBar.textContent = '当前模型：' + (name || 'deepseek-chat');
}

// 加载时读取模型名称
chrome.storage.sync.get(['modelName'], (data) => {
  updateModelStatusBar(data.modelName);
});

// 监听模型名称变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.modelName) {
      updateModelStatusBar(changes.modelName.newValue);
    }
    if (changes.systemPrompt) {
      customSystemPrompt = changes.systemPrompt.newValue || '';
    }
    if (changes.suggestQuestions) {
      suggestQuestionsEnabled = changes.suggestQuestions.newValue !== false;
    }
  }
});
