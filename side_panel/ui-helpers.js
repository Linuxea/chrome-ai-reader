// ui-helpers.js — 聊天区域 UI 辅助函数

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

function appendMessageWithQuote(quoteStr, userText) {
  const welcome = chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'message message-user';
  div.innerHTML = `<blockquote class="quote-in-bubble">${escapeHtml(quoteStr)}</blockquote><span>${escapeHtml(userText)}</span>`;

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
