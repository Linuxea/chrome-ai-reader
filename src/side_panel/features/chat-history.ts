import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import { formatDate, formatDateTime, formatDateOnly } from '../../shared/format';
import { downloadFile } from '../../shared/download';
import * as state from '../state';
import { scrollToBottom } from '../ui/dom-helpers';
import { showToast } from '../ui/toast';
import { stripImagesForPersistence } from '../../shared/strip-images';
import { addTTSButton } from '../services/tts/index.js';
import { renderMarkdown, sanitizeHtml, parseInertHtml } from '../ui/markdown';
import { emit, EVENTS } from '../events';
import type { ChatMessage } from '../../shared/types';
import { listChats, getChat, putChat, deleteChatRecord, type ChatHistoryEntry, type DisplayMessage } from '../../shared/chats-db';

export type { DisplayMessage, ChatHistoryEntry };


let _chatArea: HTMLElement;
let _historyPanel: HTMLElement;
let _historyList: HTMLElement;
let _onLoadChat: ((data: ChatLoadData) => void) | null = null;
let _onRenderOutline: ((json: string) => HTMLElement | null) | null = null;
let _onOutlineToMarkdown: ((data: unknown) => string) | null = null;

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

/**
 * UI chrome injected into live message elements after render — buttons
 * (copy/TTS/download) and thinking/typing blocks. Stripped before persisting,
 * and again when loading legacy records that stored it, so saved chats hold
 * content only and reloads don't resurrect dead buttons.
 */
const MESSAGE_CHROME_SELECTOR = '.tts-btn, .tts-download-btn, .ai-action-btn, .thinking-block, .typing-indicator, .answer-usage';

export function stripMessageChrome(html: string): string {
  // Inert parse: a stored snapshot may carry remote <img> tags that must not
  // be fetched while it is being inspected.
  const tpl = parseInertHtml(html);
  tpl.content.querySelectorAll(MESSAGE_CHROME_SELECTOR).forEach(el => el.remove());
  return sanitizeHtml(tpl.innerHTML);
}

export function getDisplayMessages(): DisplayMessage[] {
  const msgEls = _chatArea.querySelectorAll('.message');
  const messages: DisplayMessage[] = [];
  msgEls.forEach(el => {
    if (el.classList.contains('message-user')) {
      const userEl = el as HTMLElement;
      // The quote renders inside the bubble; keep it apart from the question
      // so titles show what the user asked, not the quoted page text.
      const quoteEl = userEl.querySelector('.quote-in-bubble');
      const quote = quoteEl ? (userEl.dataset.rawQuote || quoteEl.textContent || '') : '';
      const text = (quoteEl
        ? (userEl.dataset.rawDisplay ?? userEl.querySelector(':scope > span')?.textContent ?? '')
        : (userEl.textContent || '')).trim();
      // An image-only message has no text — keep a placeholder so titles and
      // exports don't show an empty turn.
      const imageOnly = !text && userEl.querySelector('.bubble-images') !== null;
      const msg: DisplayMessage = { role: 'user', content: imageOnly ? t('chat.imageOnly') : text };
      if (quote) msg.quote = quote;
      messages.push(msg);
    } else if (el.classList.contains('message-ai')) {
      if ((el as HTMLElement).dataset.type === 'outline') {
        messages.push({
          role: 'assistant',
          content: (el as HTMLElement).dataset.json || el.innerHTML,
          type: 'outline',
        });
      } else {
        // Store the Markdown source, never the rendered HTML: a snapshot would
        // persist whatever markup the model produced.
        const md = (el as HTMLElement).dataset.markdown;
        messages.push(md !== undefined
          ? { role: 'assistant', content: md, format: 'md' }
          : { role: 'assistant', content: stripMessageChrome(el.innerHTML) });
      }
    }
  });
  return messages;
}

/**
 * Snapshot synchronously, write asynchronously and in order.
 *
 * The DOM, history and chat id are captured at call time (callers such as
 * "new chat" clear them right after calling), and a new chat gets its id
 * immediately — assigning it after an await used to (a) let two overlapping
 * saves both create an entry, and (b) stamp the OLD chat's id onto the fresh
 * conversation "new chat" had just started, so later saves overwrote it.
 */
let _saveQueue: Promise<void> = Promise.resolve();

export function saveCurrentChat(): Promise<void> {
  const messages = getDisplayMessages();
  if (messages.length === 0) return _saveQueue;

  const now = Date.now();
  let chatId = state.getCurrentChatId();
  const isNew = !chatId;
  if (!chatId) {
    chatId = 'chat_' + now;
    state.setCurrentChatId(chatId);
  }
  const snapshot = {
    id: chatId,
    isNew,
    now,
    messages,
    pageTitle: state.getPageTitle(),
    pageUrl: state.getStateForTab(state.getActiveTabId() ?? -1)?.pageUrl,
    conversationHistory: state.getConversationHistory()
      .filter(m => m.role !== 'system')
      .map(stripImagesForPersistence),
  };

  const run = _saveQueue.then(() => writeChat(snapshot));
  _saveQueue = run.catch(() => { /* keep the queue alive */ });
  return run;
}

async function writeChat(snap: {
  id: string; isNew: boolean; now: number; messages: DisplayMessage[];
  pageTitle: string; pageUrl?: string; conversationHistory: ChatMessage[];
}): Promise<void> {
  const existing = await getChat(snap.id);
  if (existing) {
    await putChat({
      ...existing,
      messages: snap.messages,
      conversationHistory: snap.conversationHistory,
      pageTitle: snap.pageTitle,
      pageUrl: snap.pageUrl || existing.pageUrl,
      updatedAt: snap.now,
    });
  } else if (snap.isNew) {
    await putChat({
      id: snap.id,
      title: generateTitle(snap.messages),
      pageTitle: snap.pageTitle,
      pageUrl: snap.pageUrl,
      messages: snap.messages,
      conversationHistory: snap.conversationHistory,
      createdAt: snap.now,
      updatedAt: snap.now,
    });
  }
  // else: the chat was deleted meanwhile — don't resurrect it
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
  await deleteChatRecord(id);
  if (state.getCurrentChatId() === id) {
    state.setCurrentChatId(null);
  }
  renderHistoryList();
}

async function loadChat(id: string): Promise<void> {
  if (state.getIsGenerating()) {
    showToast(t('toast.busyGenerating'), 2500);
    return;
  }

  const chat = await getChat(id);
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

  // Render from conversationHistory — the same path as a tab switch — so user
  // bubbles come back with their original text / quote and working retry /
  // edit. Only legacy records (outline cards, or saved without history) fall
  // back to the stored display snapshot.
  const history = chat.conversationHistory || [];
  const hasOutline = chat.messages.some(m => m.type === 'outline');
  if (history.length > 0 && !hasOutline) {
    emit(EVENTS.REQUEST_RERENDER);
    _historyPanel.classList.add('hidden');
    return;
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
          div.innerHTML = renderMarkdown(msg.content);
        }
      } else if (msg.format === 'md') {
        div.innerHTML = renderMarkdown(msg.content);
        div.dataset.markdown = msg.content;
      } else {
        // Legacy HTML snapshot: strip persisted UI chrome and sanitize.
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
  const histories = await listChats();
  _historyList.innerHTML = '';

  if (histories.length === 0) {
    _historyList.innerHTML = `<div class="history-empty">${t('sidebar.historyEmpty')}</div>`;
    return;
  }

  const sorted = histories; // newest first (listChats)

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
  return parseInertHtml(html).content.textContent || '';
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
      const quoteMd = msg.quote ? '> ' + msg.quote.replace(/\n/g, '\n> ') + '\n\n' : '';
      md += '## ' + t('chat.user') + '\n\n' + quoteMd + msg.content + '\n\n';
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
        : (msg.format === 'md' ? msg.content : stripHtml(msg.content));
      assistantIdx++;
      md += '## ' + t('chat.ai') + '\n\n' + raw + '\n\n---\n\n';
    }
  });

  const title = sanitizeFilename(chatData.title || t('chat.newChat'));
  const dateStr = formatDateOnly(now);
  downloadFile(md, `${t('app.fullName')}_${dateStr}_${title}.md`, 'text/markdown;charset=utf-8');
}
