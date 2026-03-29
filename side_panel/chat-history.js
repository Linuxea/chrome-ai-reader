// chat-history.js — 聊天历史管理与导出

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
      <button class="history-item-export" title="导出">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
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

    // 导出
    item.querySelector('.history-item-export').addEventListener('click', (e) => {
      e.stopPropagation();
      exportChatAsMarkdown(chat);
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

// 文件名安全化：替换非法字符，截断长度
function sanitizeFilename(title) {
  return title.replace(/[/\\:*?"<>|\n\r]/g, '_').slice(0, 30);
}

// 去除 HTML 标签（用于旧历史记录中无原始 Markdown 时的回退）
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent;
}

// 将聊天记录导出为 Markdown 文件
async function exportChatAsMarkdown(chatData) {
  const { messages, conversationHistory = [], pageTitle: pTitle } = chatData;

  // 获取当前模型名
  const modelName = await new Promise(resolve => {
    chrome.storage.sync.get(['modelName'], data => resolve(data.modelName || 'deepseek-chat'));
  });

  // 构建元信息
  const now = new Date();
  const exportTime = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');

  let md = '# AI 阅读助手 — 聊天记录\n\n';
  if (pTitle) md += `> 页面：${pTitle}\n`;
  md += `> 导出时间：${exportTime}\n`;
  md += `> 模型：${modelName}\n\n---\n\n`;

  // 构建 assistant 内容索引映射（按顺序取 conversationHistory 中的 assistant 条目）
  const assistantEntries = conversationHistory.filter(m => m.role === 'assistant');
  let assistantIdx = 0;

  messages.forEach(msg => {
    if (msg.role === 'user') {
      md += '## 👤 用户\n\n' + msg.content + '\n\n';
    } else if (msg.role === 'assistant') {
      // 优先用 conversationHistory 中的原始 Markdown，否则回退去 HTML
      const raw = assistantIdx < assistantEntries.length
        ? assistantEntries[assistantIdx].content
        : stripHtml(msg.content);
      assistantIdx++;
      md += '## 🤖 AI 助手\n\n' + raw + '\n\n---\n\n';
    }
  });

  // 触发下载
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const title = sanitizeFilename(chatData.title || '新对话');
  const dateStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  a.href = url;
  a.download = `AI阅读助手_${dateStr}_${title}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
