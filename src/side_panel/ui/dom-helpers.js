// ui/dom-helpers.js — 聊天区域 UI 辅助函数

import { escapeHtml } from '../../shared/constants.js';
import { t } from '../../shared/i18n.js';

// marked is loaded globally via <script> tag (UMD build)
const { marked } = window;

let _chatArea;
let _actionBtns;
let _sendBtn;
let _callbacks = {};

export function initDOMHelpers({ chatArea, actionBtns, sendBtn, callbacks }) {
  _chatArea = chatArea;
  _actionBtns = actionBtns;
  _sendBtn = sendBtn;
  if (callbacks) _callbacks = callbacks;
}

export function appendMessage(role, content, imageUris) {
  const welcome = _chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message message-${role}`;

  if (role === 'ai' && content) {
    div.innerHTML = marked.parse(content);
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

export function appendMessageWithQuote(quoteStr, userText, imageUris) {
  const welcome = _chatArea.querySelector('.welcome-msg');
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

export function buildBubbleImagesHtml(imageUris) {
  return '<div class="bubble-images">' +
    imageUris.map(uri => `<img src="${uri}" class="bubble-img-thumb">`).join('') +
    '</div>';
}

export function prependBubbleImages(div, imageUris) {
  const container = document.createElement('div');
  container.innerHTML = buildBubbleImagesHtml(imageUris);
  div.insertBefore(container.firstElementChild, div.firstChild);
}

export function wrapUserMessage(msgEl) {
  const wrapper = document.createElement('div');
  wrapper.className = 'user-msg-group';
  wrapper.appendChild(msgEl);
  return wrapper;
}

function addUserActions(wrapper, msgEl) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  // 重试按钮
  const retryBtn = document.createElement('button');
  retryBtn.className = 'msg-action-btn';
  retryBtn.title = t('action.retry');
  retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
  retryBtn.addEventListener('click', () => {
    const rawText = msgEl.dataset.rawText;
    const rawQuote = msgEl.dataset.rawQuote || '';
    const rawDisplay = msgEl.dataset.rawDisplay || rawText;
    if (_callbacks.onRetry) {
      _callbacks.onRetry(wrapper, rawText, rawDisplay, rawQuote);
    }
  });

  actions.appendChild(retryBtn);
  wrapper.appendChild(actions);
}

export function removeLastMessage() {
  const messages = _chatArea.querySelectorAll('.message');
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    // 如果在 user-msg-group 内，移除整个 wrapper
    const group = last.closest('.user-msg-group');
    if (group) {
      group.remove();
    } else {
      last.remove();
    }
  }
}

export function updateLastMessage(role, content) {
  const messages = _chatArea.querySelectorAll('.message');
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

export function addTypingIndicator(msgEl) {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  msgEl.appendChild(indicator);
  return indicator;
}

export function removeTypingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.remove();
  }
}

export function scrollToBottom() {
  _chatArea.scrollTop = _chatArea.scrollHeight;
}

// 流式生成时使用智能滚动：仅在用户已处于底部附近时自动跟随，否则保持当前位置
export function smartScrollToBottom() {
  const threshold = 80;
  const distanceToBottom = _chatArea.scrollHeight - _chatArea.scrollTop - _chatArea.clientHeight;
  if (distanceToBottom <= threshold) {
    _chatArea.scrollTop = _chatArea.scrollHeight;
  }
}

export function setButtonsDisabled(disabled) {
  _actionBtns.forEach(btn => btn.disabled = disabled);
  _sendBtn.disabled = disabled;
}
