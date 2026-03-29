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

// 快捷指令
let quickCommands = [];
const commandPopup = document.getElementById('commandPopup');
let commandPopupOpen = false;
let commandSelectedIndex = 0;

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 内容截断限制（字符数，基于 DeepSeek 128K token 上下文窗口）
// 128K tokens ≈ 96K~128K 中文字符，截断值需留出对话历史和回复空间
const TRUNCATE_LIMITS = {
  CONTEXT: 32000,
  QUOTE: 32000,
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

// 加载快捷指令
function loadQuickCommands() {
  chrome.storage.local.get(['quickCommands'], (data) => {
    quickCommands = data.quickCommands || [];
  });
}
loadQuickCommands();

// 监听快捷指令变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.quickCommands) {
    quickCommands = changes.quickCommands.newValue || [];
    if (commandPopupOpen) {
      updateCommandPopup(userInput.value);
    }
  }
});

// 初始化：获取当前标签页 ID
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) activeTabId = tabs[0].id;
});

// === 事件绑定 ===

// 设置按钮
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 新建聊天
newChatBtn.addEventListener('click', () => {
  if (isGenerating) return;
  // 先保存当前会话
  saveCurrentChat();
  // 重置状态
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

// 获取筛选后的指令列表
function getFilteredCommands(input) {
  const query = input.slice(1).toLowerCase();
  if (!query) return quickCommands;
  return quickCommands.filter(cmd => cmd.name.toLowerCase().includes(query));
}

// 更新弹出列表
function updateCommandPopup(input) {
  const filtered = getFilteredCommands(input);
  if (filtered.length === 0 && quickCommands.length === 0) {
    hideCommandPopup();
    return;
  }
  commandSelectedIndex = 0;
  commandPopupOpen = true;
  renderCommandPopup(filtered);
}

// 渲染弹出列表
function renderCommandPopup(filtered) {
  commandPopup.classList.remove('hidden');

  if (filtered.length === 0) {
    commandPopup.innerHTML = '<div class="command-popup-empty">无匹配的快捷指令</div>';
    return;
  }

  commandPopup.innerHTML = filtered.map((cmd, idx) => {
    const preview = cmd.prompt.length > 30 ? cmd.prompt.slice(0, 30) + '...' : cmd.prompt;
    return `<div class="command-popup-item${idx === commandSelectedIndex ? ' selected' : ''}" data-idx="${idx}">
      <span class="command-popup-item-name">/${escapeHtml(cmd.name)}</span>
      <span class="command-popup-item-preview">${escapeHtml(preview)}</span>
    </div>`;
  }).join('');
}

// 隐藏弹出列表
function hideCommandPopup() {
  commandPopupOpen = false;
  commandSelectedIndex = 0;
  commandPopup.classList.add('hidden');
}

// 点击指令项
commandPopup.addEventListener('click', (e) => {
  const item = e.target.closest('.command-popup-item');
  if (!item) return;
  const idx = parseInt(item.dataset.idx);
  const filtered = getFilteredCommands(userInput.value);
  if (filtered[idx]) {
    executeQuickCommand(filtered[idx]);
  }
});

// 点击外部关闭
document.addEventListener('click', (e) => {
  if (commandPopupOpen && !commandPopup.contains(e.target) && e.target !== userInput) {
    hideCommandPopup();
  }
});

// 执行快捷指令
async function executeQuickCommand(cmd) {
  if (isGenerating) return;

  hideCommandPopup();
  userInput.value = '';
  await sendToAI(cmd.prompt, `/${cmd.name}`);
}

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

  const actionPrompts = {
    summarize: '请用中文总结这篇网页内容。要求：\n1. 用 3-5 个要点概括核心内容\n2. 保持客观，不添加原文没有的信息\n3. 语言简洁明了',
    translate: '请将这篇网页内容翻译为中文。要求：\n1. 准确传达原文含义\n2. 语言通顺自然\n3. 专业术语保留英文并附上中文解释',
    keyInfo: '请提取这篇网页内容的关键信息。要求：\n1. 列出所有重要的事实、数据、观点\n2. 按重要性排序\n3. 每条信息简洁明了'
  };

  const actionNames = {
    summarize: '总结页面',
    translate: '翻译',
    keyInfo: '提取关键信息'
  };

  await sendToAI(actionPrompts[action], actionNames[action]);
}

// 核心发送逻辑（统一入口）
async function sendToAI(text, displayText) {
  const quoteForContext = selectedText;

  // 显示用户消息
  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    appendMessageWithQuote(truncated, displayText);
    updateQuotePreview('');
  } else {
    appendMessage('user', displayText);
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

// 调用 AI（统一入口）
async function callAI(messages) {
  isGenerating = true;
  setButtonsDisabled(true);

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
    } else if (msg.type === 'done') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      conversationHistory.push({ role: 'assistant', content: fullText });
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
      // 自动保存
      saveCurrentChat();
    } else if (msg.type === 'error') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      msgEl.innerHTML = `<span style="color:#dc2626">${msg.error}</span>`;
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
    }
  });
}

// === UI 辅助函数 ===

function appendMessage(role, content) {
  // 移除欢迎消息
  const welcome = chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message message-${role}`;

  if (role === 'ai' && content) {
    div.innerHTML = marked.parse(content);
  } else if (content) {
    div.textContent = content;
  }

  chatArea.appendChild(div);
  scrollToBottom();
  return div;
}

function appendMessageWithQuote(quoteStr, userText) {
  const welcome = chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'message message-user';
  div.innerHTML = `<blockquote class="quote-in-bubble">${escapeHtml(quoteStr)}</blockquote><span>${escapeHtml(userText)}</span>`;

  chatArea.appendChild(div);
  scrollToBottom();
  return div;
}

function removeLastMessage() {
  const messages = chatArea.querySelectorAll('.message');
  if (messages.length > 0) {
    messages[messages.length - 1].remove();
  }
}

function updateLastMessage(role, content) {
  const messages = chatArea.querySelectorAll('.message');
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    last.className = `message message-${role}`;
    if (role === 'ai') {
      last.innerHTML = marked.parse(content);
    } else {
      last.textContent = content;
    }
  }
}

function addTypingIndicator(msgEl) {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  msgEl.appendChild(indicator);
  return indicator;
}

function removeTypingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.remove();
  }
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

// 流式生成时使用智能滚动：仅在用户已处于底部附近时自动跟随，否则保持当前位置
function smartScrollToBottom() {
  const threshold = 80;
  const distanceToBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
  if (distanceToBottom <= threshold) {
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

function setButtonsDisabled(disabled) {
  actionBtns.forEach(btn => btn.disabled = disabled);
  sendBtn.disabled = disabled;
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
  if (area === 'sync' && changes.modelName) {
    updateModelStatusBar(changes.modelName.newValue);
  }
});
