import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import { formatDate, formatDateTime, formatDateOnly } from '../../shared/format';
import { downloadFile } from '../../shared/download';
import * as state from '../state';
import { scrollToBottom } from '../ui/dom-helpers';
import { stripImagesForPersistence } from '../services/chat/strip-images';
import { addTTSButton } from '../services/tts/index.js';
import { marked } from 'marked';
import type { ChatMessage } from '../../shared/types';

const STORAGE_KEY = 'chatHistories';
const MAX_HISTORIES = 50;

let _chatArea: HTMLElement;
let _historyPanel: HTMLElement;
let _historyList: HTMLElement;
let _onLoadChat: ((data: ChatLoadData) => void) | null = null;
let _onRenderOutline: ((json: string) => HTMLElement | null) | null = null;
let _onOutlineToMarkdown: ((data: unknown) => string) | null = null;

interface DisplayMessage {
  role: string;
  content: string;
  type?: string;
}

interface ChatHistoryEntry {
  id: string;
  title: string;
  pageTitle?: string;
  messages: DisplayMessage[];
  conversationHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatLoadData {
  id: string;
  pageTitle: string;
  pageContent: string;
  pageExcerpt: string;
  messages: ChatMessage[];
  displayMessages: DisplayMessage[];
}

interface ChatHistoryInitDeps {
  chatArea: HTMLElement;
  historyPanel: HTMLElement;
  historyList: HTMLElement;
  onLoadChat: (data: ChatLoadData) => void;
  onRenderOutline: (json: string) => HTMLElement | null;
  onOutlineToMarkdown: (data: unknown) => string;
}

export function initChatHistory({ chatArea, historyPanel, historyList, onLoadChat, onRenderOutline, onOutlineToMarkdown }: ChatHistoryInitDeps): void {
  _chatArea = chatArea;
  _historyPanel = historyPanel;
  _historyList = historyList;
  _onLoadChat = onLoadChat;
  _onRenderOutline = onRenderOutline;
  _onOutlineToMarkdown = onOutlineToMarkdown;
}

function getChatHistories(): Promise<ChatHistoryEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      resolve((data[STORAGE_KEY] as ChatHistoryEntry[]) || []);
    });
  });
}

function saveChatHistories(histories: ChatHistoryEntry[]): Promise<void> {
  if (histories.length > MAX_HISTORIES) {
    histories = histories.slice(histories.length - MAX_HISTORIES);
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: histories }, () => resolve());
  });
}

/**
 * UI chrome injected into live message elements after render — buttons
 * (copy/TTS/download) and thinking/typing blocks. Stripped before persisting,
 * and again when loading legacy records that stored it, so saved chats hold
 * content only and reloads don't resurrect dead buttons.
 */
const MESSAGE_CHROME_SELECTOR = '.tts-btn, .tts-download-btn, .ai-action-btn, .thinking-block, .typing-indicator';

export function stripMessageChrome(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll(MESSAGE_CHROME_SELECTOR).forEach(el => el.remove());
  return tmp.innerHTML;
}

export function getDisplayMessages(): DisplayMessage[] {
  const msgEls = _chatArea.querySelectorAll('.message');
  const messages: DisplayMessage[] = [];
  msgEls.forEach(el => {
    if (el.classList.contains('message-user')) {
      messages.push({ role: 'user', content: el.textContent || '' });
    } else if (el.classList.contains('message-ai')) {
      if ((el as HTMLElement).dataset.type === 'outline') {
        messages.push({
          role: 'assistant',
          content: (el as HTMLElement).dataset.json || el.innerHTML,
          type: 'outline',
        });
      } else {
        messages.push({ role: 'assistant', content: stripMessageChrome(el.innerHTML) });
      }
    }
  });
  return messages;
}

export async function saveCurrentChat(): Promise<void> {
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
      histories[idx].conversationHistory = conversationHistory
        .filter(m => m.role !== 'system')
        .map(stripImagesForPersistence);
      histories[idx].pageTitle = pageTitle;
      histories[idx].updatedAt = now;
      await saveChatHistories(histories);
    }
  } else {
    const title = generateTitle(messages);
    const chat: ChatHistoryEntry = {
      id: 'chat_' + now,
      title,
      pageTitle,
      messages,
      conversationHistory: conversationHistory
        .filter(m => m.role !== 'system')
        .map(stripImagesForPersistence),
      createdAt: now,
      updatedAt: now,
    };
    const histories = await getChatHistories();
    histories.push(chat);
    state.setCurrentChatId(chat.id);
    await saveChatHistories(histories);
  }
}

export function generateTitle(messages: DisplayMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    const text = firstUser.content.slice(0, 30);
    return text.length < firstUser.content.length ? text + '...' : text;
  }
  return t('chat.newChat');
}

export async function deleteChat(id: string): Promise<void> {
  const histories = await getChatHistories();
  const filtered = histories.filter(h => h.id !== id);
  await saveChatHistories(filtered);
  if (state.getCurrentChatId() === id) {
    state.setCurrentChatId(null);
  }
  renderHistoryList();
}

async function loadChat(id: string): Promise<void> {
  if (state.getIsGenerating()) return;

  const histories = await getChatHistories();
  const chat = histories.find(h => h.id === id);
  if (!chat) return;

  if (_onLoadChat) {
    _onLoadChat({
      id: chat.id,
      pageTitle: chat.pageTitle || '',
      pageContent: '',
      pageExcerpt: '',
      messages: chat.conversationHistory || [],
      displayMessages: chat.messages,
    });
  }

  _chatArea.innerHTML = '';
  chat.messages.forEach(msg => {
    const div = document.createElement('div');
    if (msg.role === 'user') {
      div.className = 'message message-user';
      div.textContent = msg.content;
      div.dataset.rawText = msg.content;
      div.dataset.rawDisplay = msg.content;
    } else if (msg.role === 'assistant') {
      div.className = 'message message-ai';
      if (msg.type === 'outline') {
        const outlineEl = _onRenderOutline!(msg.content);
        if (outlineEl) {
          div.appendChild(outlineEl);
          div.dataset.type = 'outline';
          div.dataset.json = msg.content;
        } else {
          div.innerHTML = marked.parse(msg.content) as string;
        }
      } else {
        // Legacy records may contain persisted UI chrome — strip it on the way in.
        div.innerHTML = stripMessageChrome(msg.content);
      }
      // Restored answers get their copy/TTS/download buttons back.
      addTTSButton(div);
    }
    _chatArea.appendChild(div);
  });
  scrollToBottom();

  _historyPanel.classList.add('hidden');
}

export async function renderHistoryList(): Promise<void> {
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

    item.querySelector('.history-item-info')!.addEventListener('click', () => {
      loadChat(chat.id);
    });

    item.querySelector('.history-item-export')!.addEventListener('click', (e) => {
      e.stopPropagation();
      exportChatAsMarkdown(chat);
    });

    const deleteBtn = item.querySelector('.history-item-delete') as HTMLButtonElement;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      /* Two-step confirm: first click arms the button (it reverts after 2.5s),
         second click actually deletes — no more instant accidental deletes. */
      if (deleteBtn.classList.contains('confirming')) {
        deleteChat(chat.id);
        return;
      }
      deleteBtn.classList.add('confirming');
      deleteBtn.title = t('history.confirmDelete');
      setTimeout(() => {
        deleteBtn.classList.remove('confirming');
        deleteBtn.title = t('settings.commands.delete');
      }, 2500);
    });

    _historyList.appendChild(item);
  });
}

export function sanitizeFilename(title: string): string {
  return title.replace(/[/\\:*?"<>|\n\r]/g, '_').slice(0, 30);
}

export function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

export async function exportChatAsMarkdown(chatData: { messages: DisplayMessage[]; conversationHistory?: ChatMessage[]; pageTitle?: string; title?: string }): Promise<void> {
  const { messages, conversationHistory = [], pageTitle: pTitle } = chatData;

  const modelName = await new Promise<string>(resolve => {
    chrome.storage.sync.get(['modelName'], data => resolve((data.modelName as string) || 'deepseek-chat'));
  });

  const now = new Date();
  const exportTime = formatDateTime(now);

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
            md += '## ' + t('chat.ai') + '\n\n' + _onOutlineToMarkdown!(data) + '\n\n---\n\n';
            assistantIdx++;
            return;
          }
        } catch { /* not a valid outline JSON */ }
      }
      const raw = assistantIdx < assistantEntries.length
        ? assistantEntries[assistantIdx].content
        : stripHtml(msg.content);
      assistantIdx++;
      md += '## ' + t('chat.ai') + '\n\n' + raw + '\n\n---\n\n';
    }
  });

  const title = sanitizeFilename(chatData.title || t('chat.newChat'));
  const dateStr = formatDateOnly(now);
  downloadFile(md, `${t('app.fullName')}_${dateStr}_${title}.md`, 'text/markdown;charset=utf-8');
}
