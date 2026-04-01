// features/chat-history.js — 聊天历史管理与导出

import { t, getCurrentLang } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
import { scrollToBottom } from '../ui/dom-helpers.js';
import { marked } from 'marked';

const STORAGE_KEY = 'chatHistories';
const MAX_HISTORIES = 50;

let _chatArea;
let _historyPanel;
let _historyList;
let _onLoadChat;
let _onRenderOutline;
let _onOutlineToMarkdown;

export function initChatHistory({ chatArea, historyPanel, historyList, onLoadChat, onRenderOutline, onOutlineToMarkdown }) {
  _chatArea = chatArea;
  _historyPanel = historyPanel;
  _historyList = historyList;
  _onLoadChat = onLoadChat;
  _onRenderOutline = onRenderOutline;
  _onOutlineToMarkdown = onOutlineToMarkdown;
}

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

export function getDisplayMessages() {
  const msgEls = _chatArea.querySelectorAll('.message');
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

export async function saveCurrentChat() {
  const messages = getDisplayMessages();
  if (messages.length === 0) return;

  const now = Date.now();
  const currentChatId = state.getCurrentChatId();
  const conversationHistory = state.getConversationHistory();
  const pageTitle = state.getPageTitle();

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
    state.setCurrentChatId(chat.id);
    await saveChatHistories(histories);
  }
}

export function generateTitle(messages) {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    const text = firstUser.content.slice(0, 30);
    return text.length < firstUser.content.length ? text + '...' : text;
  }
  return t('chat.newChat');
}

export async function deleteChat(id) {
  const histories = await getChatHistories();
  const filtered = histories.filter(h => h.id !== id);
  await saveChatHistories(filtered);
  if (state.getCurrentChatId() === id) {
    state.setCurrentChatId(null);
  }
  renderHistoryList();
}

async function loadChat(id) {
  const histories = await getChatHistories();
  const chat = histories.find(h => h.id === id);
  if (!chat) return;

  // Delegate to main.js handler
  if (_onLoadChat) {
    _onLoadChat({
      id: chat.id,
      pageTitle: chat.pageTitle || '',
      pageContent: '',
      pageExcerpt: '',
      messages: chat.conversationHistory || [],
      displayMessages: chat.messages
    });
  }

  _chatArea.innerHTML = '';
  chat.messages.forEach(msg => {
    const div = document.createElement('div');
    if (msg.role === 'user') {
      div.className = 'message message-user';
      div.textContent = msg.content;
    } else if (msg.role === 'assistant') {
      div.className = 'message message-ai';
      if (msg.type === 'outline') {
        const outlineEl = _onRenderOutline(msg.content);
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
    _chatArea.appendChild(div);
  });
  scrollToBottom();

  _historyPanel.classList.add('hidden');
}

export async function renderHistoryList() {
  const histories = await getChatHistories();
  _historyList.innerHTML = '';

  if (histories.length === 0) {
    _historyList.innerHTML = `<div class="history-empty">${t('sidebar.historyEmpty')}</div>`;
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

    _historyList.appendChild(item);
  });
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const locale = getCurrentLang() === 'en' ? 'en-US' : 'zh-CN';
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

export async function exportChatAsMarkdown(chatData) {
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
            md += '## ' + t('chat.ai') + '\n\n' + _onOutlineToMarkdown(data) + '\n\n---\n\n';
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
