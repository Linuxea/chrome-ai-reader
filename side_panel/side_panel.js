// side_panel.js — 侧边栏交互逻辑

const chatArea = document.getElementById('chatArea');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');
const actionBtns = document.querySelectorAll('.action-btn');

// 当前页面的内容上下文
let pageContent = '';
let pageExcerpt = '';
let pageTitle = '';
// 对话历史
let conversationHistory = [];
// 是否正在生成回复
let isGenerating = false;

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true
});

// === 事件绑定 ===

// 设置按钮
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
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

// === 核心功能 ===

// 提取当前页面内容
async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    // 如果还没有页面内容，先提取
    if (!pageContent) {
      await extractPageContent();
    }

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
