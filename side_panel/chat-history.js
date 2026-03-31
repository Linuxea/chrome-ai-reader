// chat-history.js — 聊天历史管理与导出

const STORAGE_KEY = 'chatHistories';
const MAX_HISTORIES = 50;

function getChatHistories() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      resolve(data[STORAGE_KEY] || []);
    });
  });
}

function saveChatHistories(histories) {
  if (histories.length > MAX_HISTORIES) {
    histories = histories.slice(histories.length - MAX_HISTORIES);
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: histories }, resolve);
  });
}

function getDisplayMessages() {
  const msgEls = chatArea.querySelectorAll('.message');
  const messages = [];
  msgEls.forEach(el => {
    if (el.classList.contains('message-user')) {
      messages.push({ role: 'user', content: el.textContent });
    } else if (el.classList.contains('message-ai')) {
      if (el.dataset.type === 'outline') {
        messages.push({
          role: 'assistant',
          content: el.dataset.json || el.innerHTML,
          type: 'outline'
        });
      } else {
        messages.push({ role: 'assistant', content: el.innerHTML });
      }
    }
  });
  return messages;
}

async function saveCurrentChat() {
  const messages = getDisplayMessages();
  if (messages.length === 0) return;

  const now = Date.now();

  if (currentChatId) {
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

function generateTitle(messages) {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    const text = firstUser.content.slice(0, 30);
    return text.length < firstUser.content.length ? text + '...' : text;
  }
  return t('chat.newChat');
}

async function deleteChat(id) {
  const histories = await getChatHistories();
  const filtered = histories.filter(h => h.id !== id);
  await saveChatHistories(filtered);
  if (currentChatId === id) {
    currentChatId = null;
  }
  renderHistoryList();
}

async function loadChat(id) {
  const histories = await getChatHistories();
  const chat = histories.find(h => h.id === id);
  if (!chat) return;

  currentChatId = chat.id;
  pageTitle = chat.pageTitle || '';
  pageContent = '';
  pageExcerpt = '';
  updateQuotePreview('');
  conversationHistory = chat.conversationHistory || [];

  chatArea.innerHTML = '';
  chat.messages.forEach(msg => {
    const div = document.createElement('div');
    if (msg.role === 'user') {
      div.className = 'message message-user';
      div.textContent = msg.content;
    } else if (msg.role === 'assistant') {
      div.className = 'message message-ai';
      if (msg.type === 'outline') {
        const outlineEl = renderOutlineFromJSON(msg.content);
        if (outlineEl) {
          div.appendChild(outlineEl);
          div.dataset.type = 'outline';
          div.dataset.json = msg.content;
        } else {
          div.innerHTML = marked.parse(msg.content);
        }
      } else {
        div.innerHTML = msg.content;
      }
    }
    chatArea.appendChild(div);
  });
  scrollToBottom();

  historyPanel.classList.add('hidden');
}

async function renderHistoryList() {
  const histories = await getChatHistories();
  historyList.innerHTML = '';

  if (histories.length === 0) {
    historyList.innerHTML = `<div class="history-empty">${t('sidebar.historyEmpty')}</div>`;
    return;
  }

  const sorted = [...histories].reverse();

  sorted.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-info">
        <div class="history-item-title">${escapeHtml(chat.title)}</div>
        <div class="history-item-date">${formatDate(chat.updatedAt)}</div>
      </div>
      <button class="history-item-export" title="${t('action.export')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
      <button class="history-item-delete" title="${t('settings.commands.delete')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    item.querySelector('.history-item-info').addEventListener('click', () => {
      loadChat(chat.id);
    });

    item.querySelector('.history-item-export').addEventListener('click', (e) => {
      e.stopPropagation();
      exportChatAsMarkdown(chat);
    });

    item.querySelector('.history-item-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });

    historyList.appendChild(item);
  });
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const locale = currentLang === 'en' ? 'en-US' : 'zh-CN';
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  if (isToday) return t('chat.today') + ' ' + time;
  if (isYesterday) return t('chat.yesterday') + ' ' + time;
  return d.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }) + ' ' + time;
}

function sanitizeFilename(title) {
  return title.replace(/[/\\:*?"<>|\n\r]/g, '_').slice(0, 30);
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent;
}

async function exportChatAsMarkdown(chatData) {
  const { messages, conversationHistory = [], pageTitle: pTitle } = chatData;

  const modelName = await new Promise(resolve => {
    chrome.storage.sync.get(['modelName'], data => resolve(data.modelName || 'deepseek-chat'));
  });

  const now = new Date();
  const exportTime = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');

  let md = '# ' + t('chat.exportTitle') + '\n\n';
  if (pTitle) md += `> ${t('chat.exportPage')}${pTitle}\n`;
  md += `> ${t('chat.exportTime')}${exportTime}\n`;
  md += `> ${t('chat.exportModel')}${modelName}\n\n---\n\n`;

  const assistantEntries = conversationHistory.filter(m => m.role === 'assistant');
  let assistantIdx = 0;

  messages.forEach(msg => {
    if (msg.role === 'user') {
      md += '## ' + t('chat.user') + '\n\n' + msg.content + '\n\n';
    } else if (msg.role === 'assistant') {
      if (msg.type === 'outline') {
        try {
          const data = JSON.parse(msg.content);
          if (data && data.title && data.sections) {
            md += '## ' + t('chat.ai') + '\n\n' + outlineToMarkdown(data) + '\n\n---\n\n';
            assistantIdx++;
            return;
          }
        } catch(e) {}
      }
      const raw = assistantIdx < assistantEntries.length
        ? assistantEntries[assistantIdx].content
        : stripHtml(msg.content);
      assistantIdx++;
      md += '## ' + t('chat.ai') + '\n\n' + raw + '\n\n---\n\n';
    }
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const title = sanitizeFilename(chatData.title || t('chat.newChat'));
  const dateStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  a.href = url;
  a.download = `${t('app.fullName')}_${dateStr}_${title}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
