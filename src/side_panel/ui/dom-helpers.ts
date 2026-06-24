import { escapeHtml } from '../../shared/constants';
import { t } from '../../shared/i18n.js';
import { CSS } from '../../shared/css-selectors';
import { marked } from 'marked';
import { emit, EVENTS } from '../events';
import type { ChatMessage, MessageContentPart } from '../../shared/types';

let _chatArea: HTMLElement;
let _actionBtns: NodeListOf<HTMLButtonElement>;
let _sendBtn: HTMLButtonElement;

interface DOMHelperDeps {
  chatArea: HTMLElement;
  actionBtns: NodeListOf<HTMLButtonElement>;
  sendBtn: HTMLButtonElement;
}

export function initDOMHelpers({ chatArea, actionBtns, sendBtn }: DOMHelperDeps): void {
  _chatArea = chatArea;
  _actionBtns = actionBtns;
  _sendBtn = sendBtn;
}

export function appendMessage(role: string, content: string, imageUris?: string[]): HTMLDivElement {
  const welcome = _chatArea.querySelector(CSS.WELCOME_MSG);
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message message-${role}`;

  if (role === 'ai' && content) {
    div.innerHTML = marked.parse(content) as string;
  } else if (content) {
    div.textContent = content;
  }

  if (imageUris && imageUris.length > 0 && role === 'user') {
    prependBubbleImages(div, imageUris);
  }

  if (role === 'user') {
    const wrapper = wrapUserMessage(div);
    addUserActions(wrapper, div);
    _chatArea.appendChild(wrapper);
  } else {
    _chatArea.appendChild(div);
  }

  scrollToBottom();
  return div;
}

export function appendMessageWithQuote(quoteStr: string, userText: string, imageUris?: string[]): HTMLDivElement {
  const welcome = _chatArea.querySelector(CSS.WELCOME_MSG);
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'message message-user';

  let html = '';
  if (imageUris && imageUris.length > 0) {
    html += buildBubbleImagesHtml(imageUris);
  }
  html += `<blockquote class="quote-in-bubble">${escapeHtml(quoteStr)}</blockquote><span>${escapeHtml(userText)}</span>`;
  div.innerHTML = html;

  const wrapper = wrapUserMessage(div);
  addUserActions(wrapper, div);

  _chatArea.appendChild(wrapper);
  scrollToBottom();
  return div;
}

export function buildBubbleImagesHtml(imageUris: string[]): string {
  return '<div class="bubble-images">' +
    imageUris.map(uri => `<img src="${uri.replace(/"/g, '&quot;')}" class="bubble-img-thumb">`).join('') +
    '</div>';
}

export function prependBubbleImages(div: HTMLDivElement, imageUris: string[]): void {
  const container = document.createElement('div');
  container.innerHTML = buildBubbleImagesHtml(imageUris);
  if (container.firstElementChild) {
    div.insertBefore(container.firstElementChild, div.firstChild);
  }
}

export function wrapUserMessage(msgEl: HTMLDivElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'user-msg-group';
  wrapper.appendChild(msgEl);
  return wrapper;
}

function addUserActions(wrapper: HTMLDivElement, msgEl: HTMLDivElement): void {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'msg-action-btn';
  retryBtn.title = t('action.retry');
  retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
  retryBtn.addEventListener('click', () => {
    const rawText = msgEl.dataset.rawText || '';
    const rawQuote = msgEl.dataset.rawQuote || '';
    const rawDisplay = msgEl.dataset.rawDisplay || rawText;
    emit(EVENTS.RETRY, { wrapper, rawText, rawDisplay, rawQuote });
  });

  actions.appendChild(retryBtn);
  wrapper.appendChild(actions);
}

export function removeLastMessage(): void {
  const messages = _chatArea.querySelectorAll(CSS.MESSAGE);
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const group = last.closest('.user-msg-group');
    if (group) {
      group.remove();
    } else {
      last.remove();
    }
  }
}

export function updateLastMessage(role: string, content: string): void {
  const messages = _chatArea.querySelectorAll(CSS.MESSAGE);
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    last.className = `message message-${role}`;
    if (role === 'ai') {
      last.innerHTML = marked.parse(content) as string;
    } else {
      last.textContent = content;
    }
  }
}

export function addTypingIndicator(msgEl: HTMLElement): HTMLDivElement {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  msgEl.appendChild(indicator);
  return indicator;
}

export function removeTypingIndicator(indicator: HTMLElement | null): void {
  if (indicator && indicator.parentNode) {
    indicator.remove();
  }
}

export function scrollToBottom(): void {
  _chatArea.scrollTop = _chatArea.scrollHeight;
}

export function smartScrollToBottom(): void {
  const threshold = 80;
  const distanceToBottom = _chatArea.scrollHeight - _chatArea.scrollTop - _chatArea.clientHeight;
  if (distanceToBottom <= threshold) {
    _chatArea.scrollTop = _chatArea.scrollHeight;
  }
}

export function setButtonsDisabled(disabled: boolean): void {
  _actionBtns.forEach(btn => {
    const action = btn.dataset.action;
    if (action === 'podcast') return;
    btn.disabled = disabled;
  });
  _sendBtn.disabled = disabled;
}

/**
 * Render a chat message from `conversationHistory` (memory or reloaded from
 * storage) into the chat area. Handles both string content (plain text) and
 * array content (multimodal — extracts image_url thumbnails). On reload,
 * `hadImages: true` with string content means images were stripped at
 * persistence time → show an "image lost" hint.
 */
export function appendMessageFromHistory(msg: ChatMessage): HTMLDivElement {
  const imageUris = extractImageUrisFromContent(msg);
  const text = extractTextFromContent(msg);
  const role = msg.role === 'assistant' ? 'ai' : msg.role;
  const div = appendMessage(role, text, imageUris);

  if (msg.hadImages && imageUris.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'image-lost-hint';
    hint.textContent = t('error.imageLostAfterReload');
    div.insertBefore(hint, div.firstChild);
  }
  return div;
}

export function extractImageUrisFromContent(msg: ChatMessage): string[] {
  if (typeof msg.content === 'string') return [];
  return msg.content
    .filter((p): p is Extract<MessageContentPart, { type: 'image_url' }> => p.type === 'image_url')
    .map(p => p.image_url.url);
}

function extractTextFromContent(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((p): p is Extract<MessageContentPart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}
