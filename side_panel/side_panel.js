// side_panel.js — 侧边栏交互逻辑

const chatArea = document.getElementById('chatArea');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');
const newChatBtn = document.getElementById('newChatBtn');
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
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 输入框自动调整高度
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
});

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

// === 历史对话管理 ===

const STORAGE_KEY = 'chatHistories';
const MAX_HISTORIES = 50;

// 获取所有历史记录
function getChatHistories() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      resolve(data[STORAGE_KEY] || []);
    });
  });
}

// 保存所有历史记录
function saveChatHistories(histories) {
  // 只保留最新的 MAX_HISTORIES 条
  if (histories.length > MAX_HISTORIES) {
    histories = histories.slice(histories.length - MAX_HISTORIES);
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: histories }, resolve);
  });
}

// 从当前 DOM 提取显示消息（用于持久化）
function getDisplayMessages() {
  const msgEls = chatArea.querySelectorAll('.message');
  const messages = [];
  msgEls.forEach(el => {
    if (el.classList.contains('message-user')) {
      messages.push({ role: 'user', content: el.textContent });
    } else if (el.classList.contains('message-ai')) {
      // AI 消息用 raw HTML（markdown 已渲染）
      messages.push({ role: 'assistant', content: el.innerHTML });
    }
    // 忽略 error 消息
  });
  return messages;
}

// 保存当前会话到历史
async function saveCurrentChat() {
  const messages = getDisplayMessages();
  if (messages.length === 0) return;

  const now = Date.now();

  if (currentChatId) {
    // 更新已有会话
    const histories = await getChatHistories();
    const idx = histories.findIndex(h => h.id === currentChatId);
    if (idx !== -1) {
      histories[idx].messages = messages;
      histories[idx].conversationHistory = conversationHistory.filter(m => m.role !== 'system');
      histories[idx].pageTitle = pageTitle;
      histories[idx].updatedAt = now;
      await saveChatHistories(histories);
    }
  } else {
    // 新建历史记录
    const title = generateTitle(messages);
    const chat = {
      id: 'chat_' + now,
      title,
      pageTitle,
      messages,
      conversationHistory: conversationHistory.filter(m => m.role !== 'system'),
      createdAt: now,
      updatedAt: now
    };
    const histories = await getChatHistories();
    histories.push(chat);
    currentChatId = chat.id;
    await saveChatHistories(histories);
  }
}

// 生成会话标题
function generateTitle(messages) {
  // 找第一条用户消息
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    const text = firstUser.content.slice(0, 30);
    return text.length < firstUser.content.length ? text + '...' : text;
  }
  return '新对话';
}

// 删除历史会话
async function deleteChat(id) {
  const histories = await getChatHistories();
  const filtered = histories.filter(h => h.id !== id);
  await saveChatHistories(filtered);
  if (currentChatId === id) {
    currentChatId = null;
  }
  renderHistoryList();
}

// 加载历史会话
async function loadChat(id) {
  const histories = await getChatHistories();
  const chat = histories.find(h => h.id === id);
  if (!chat) return;

  // 恢复状态
  currentChatId = chat.id;
  pageTitle = chat.pageTitle || '';
  pageContent = ''; // 页面内容会在下次发消息时重新提取
  pageExcerpt = '';
  updateQuotePreview('');
  conversationHistory = chat.conversationHistory || [];

  // 渲染消息
  chatArea.innerHTML = '';
  chat.messages.forEach(msg => {
    const div = document.createElement('div');
    if (msg.role === 'user') {
      div.className = 'message message-user';
      div.textContent = msg.content;
    } else if (msg.role === 'assistant') {
      div.className = 'message message-ai';
      div.innerHTML = msg.content;
    }
    chatArea.appendChild(div);
  });
  scrollToBottom();

  // 关闭历史面板
  historyPanel.classList.add('hidden');
}

// 渲染历史列表
async function renderHistoryList() {
  const histories = await getChatHistories();
  historyList.innerHTML = '';

  if (histories.length === 0) {
    historyList.innerHTML = '<div class="history-empty">暂无历史对话</div>';
    return;
  }

  // 按更新时间倒序
  const sorted = [...histories].reverse();

  sorted.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-info">
        <div class="history-item-title">${escapeHtml(chat.title)}</div>
        <div class="history-item-date">${formatDate(chat.updatedAt)}</div>
      </div>
      <button class="history-item-delete" title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    // 点击加载
    item.querySelector('.history-item-info').addEventListener('click', () => {
      loadChat(chat.id);
    });

    // 删除
    item.querySelector('.history-item-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });

    historyList.appendChild(item);
  });
}

// 格式化日期
function formatDate(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return '今天 ' + time;
  if (isYesterday) return '昨天 ' + time;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' ' + time;
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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

  const templates = {
    summarize: '总结页面',
    translate: '翻译',
    keyInfo: '提取关键信息'
  };

  try {
    // 提取页面内容
    appendMessage('user', `${templates[action]}（正在读取页面...）`);

    const data = await extractPageContent();
    if (!data.textContent.trim()) {
      removeLastMessage();
      appendMessage('error', '当前页面没有可读取的内容');
      return;
    }

    // 构建消息
    const prompt = getPromptTemplate(action, data.textContent);
    conversationHistory = [];
    if (customSystemPrompt) {
      conversationHistory.push({ role: 'system', content: customSystemPrompt });
    }
    conversationHistory.push({ role: 'user', content: prompt });

    // 替换用户消息为实际操作名
    updateLastMessage('user', templates[action]);

    // 调用 AI
    await callAI(conversationHistory);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
  }
}

// 获取 Prompt 模板
function getPromptTemplate(action, content) {
  const maxLen = 12000; // 限制内容长度，避免超出 token 限制
  const truncated = content.length > maxLen
    ? content.slice(0, maxLen) + '\n\n[内容过长，已截断]'
    : content;

  const templates = {
    summarize: `请用中文总结以下网页内容。要求：
1. 用 3-5 个要点概括核心内容
2. 保持客观，不添加原文没有的信息
3. 语言简洁明了

网页标题：${pageTitle}

网页内容如下：
${truncated}`,

    translate: `请将以下网页内容翻译为中文。要求：
1. 准确传达原文含义
2. 语言通顺自然
3. 专业术语保留英文并附上中文解释

网页标题：${pageTitle}

网页内容如下：
${truncated}`,

    keyInfo: `请提取以下网页内容的关键信息。要求：
1. 列出所有重要的事实、数据、观点
2. 按重要性排序
3. 每条信息简洁明了

网页标题：${pageTitle}

网页内容如下：
${truncated}`
  };

  return templates[action] || truncated;
}

// 自由问答发送
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isGenerating) return;

  userInput.value = '';
  userInput.style.height = 'auto';
  appendMessage('user', text);

  try {
    // 每次发送消息都重新提取页面内容，确保获取最新内容
    await extractPageContent();

    // 构建消息列表（带页面上下文）
    const messages = [];
    if (pageContent) {
      const contextLen = 8000;
      const context = pageContent.length > contextLen
        ? pageContent.slice(0, contextLen) + '\n\n[内容过长，已截断]'
        : pageContent;

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
    // 当前用户消息
    messages.push({ role: 'user', content: text });
    conversationHistory.push({ role: 'user', content: text });

    await callAI(messages);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
  }
}

// 调用 AI（统一入口）
async function callAI(messages) {
  isGenerating = true;
  setButtonsDisabled(true);

  const msgEl = appendMessage('ai', '');
  const typingEl = addTypingIndicator(msgEl);
  let fullText = '';

  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({
    type: 'chat',
    messages: messages
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      fullText += msg.content;
      removeTypingIndicator(typingEl);
      msgEl.innerHTML = marked.parse(fullText);
      scrollToBottom();
    } else if (msg.type === 'done') {
      removeTypingIndicator(typingEl);
      conversationHistory.push({ role: 'assistant', content: fullText });
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
      // 自动保存
      saveCurrentChat();
    } else if (msg.type === 'error') {
      removeTypingIndicator(typingEl);
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

function setButtonsDisabled(disabled) {
  actionBtns.forEach(btn => btn.disabled = disabled);
  sendBtn.disabled = disabled;
}
