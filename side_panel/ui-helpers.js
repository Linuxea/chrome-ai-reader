// ui-helpers.js — 聊天区域 UI 辅助函数

// === UI 辅助函数 ===

function appendMessage(role, content, imageUris) {
  const welcome = chatArea.querySelector('.welcome-msg');
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
    chatArea.appendChild(wrapper);
  } else {
    chatArea.appendChild(div);
  }

  scrollToBottom();
  return div;
}

function appendMessageWithQuote(quoteStr, userText, imageUris) {
  const welcome = chatArea.querySelector('.welcome-msg');
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

  chatArea.appendChild(wrapper);
  scrollToBottom();
  return div;
}

function buildBubbleImagesHtml(imageUris) {
  return '<div class="bubble-images">' +
    imageUris.map(uri => `<img src="${uri}" class="bubble-img-thumb">`).join('') +
    '</div>';
}

function prependBubbleImages(div, imageUris) {
  const container = document.createElement('div');
  container.innerHTML = buildBubbleImagesHtml(imageUris);
  div.insertBefore(container.firstElementChild, div.firstChild);
}

function wrapUserMessage(msgEl) {
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
  retryBtn.title = '重新发送';
  retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
  retryBtn.addEventListener('click', () => {
    const rawText = msgEl.dataset.rawText;
    const rawQuote = msgEl.dataset.rawQuote || '';
    const rawDisplay = msgEl.dataset.rawDisplay || rawText;
    retryMessage(wrapper, rawText, rawDisplay, rawQuote);
  });

  actions.appendChild(retryBtn);
  wrapper.appendChild(actions);
}

function removeLastMessage() {
  const messages = chatArea.querySelectorAll('.message');
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
