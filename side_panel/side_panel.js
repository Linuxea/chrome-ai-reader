// side_panel.js — 侧边栏交互逻辑

const chatArea = document.getElementById('chatArea');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');
const newChatBtn = document.getElementById('newChatBtn');
const exportBtn = document.getElementById('exportBtn');
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historyBackBtn = document.getElementById('historyBackBtn');
const historyList = document.getElementById('historyList');
const actionBtns = document.querySelectorAll('.action-btn');
const quotePreview = document.getElementById('quotePreview');
const quoteText = document.getElementById('quoteText');
const quoteClose = document.getElementById('quoteClose');

// 当前页面的内容上下文
let pageContent = '';
let pageExcerpt = '';
let pageTitle = '';
// 对话历史
let conversationHistory = [];
// 是否正在生成回复
let isGenerating = false;
// 自定义 system prompt
let customSystemPrompt = '';
// 当前聊天 ID（null 表示新会话）
let currentChatId = null;
// 选中的引用文本
let selectedText = '';
// 当前关联的标签页 ID
let activeTabId = null;

// 快捷指令状态（由 quick-commands.js 管理）
// commandPopupOpen, commandSelectedIndex, quickCommands 等在 quick-commands.js 中定义

// TTS 播放状态
let ttsAudioCtx = null;
let ttsCurrentSource = null;
let ttsPort = null;
let ttsPlaying = false;
let ttsDone = false;

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 内容截断限制（字符数，基于 DeepSeek 128K token 上下文窗口）
// 128K tokens ≈ 96K~128K 中文字符，截断值需留出对话历史和回复空间
const TRUNCATE_LIMITS = {
  CONTEXT: 64000,
  QUOTE: 64000,
};

/**
 * 安全截断文本，按 code point 切割并在段落/句子边界处断开
 * 避免在 UTF-16 代理对中间截断（如 emoji、罕见 CJK 字符）
 */
function safeTruncate(text, maxLen, suffix = '\n\n[内容过长，已截断]') {
  if (!text) return text;
  const chars = [...text]; // 按 code point 展开，避免拆开代理对
  if (chars.length <= maxLen) return text;

  const truncated = chars.slice(0, maxLen).join('');
  // 在截断点附近找最近的换行符作为自然断点（回溯 200 字符）
  const lookback = Math.min(200, maxLen);
  const tail = truncated.slice(-lookback);
  const lastBreak = tail.lastIndexOf('\n');
  if (lastBreak > 0) {
    return truncated.slice(0, truncated.length - lookback + lastBreak + 1) + suffix;
  }
  return truncated + suffix;
}

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true
});

// 加载自定义 system prompt
chrome.storage.sync.get(['systemPrompt'], (data) => {
  if (data.systemPrompt) {
    customSystemPrompt = data.systemPrompt;
  }
});

// 初始化：获取当前标签页 ID
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) activeTabId = tabs[0].id;
});

// === 事件绑定 ===

// 设置按钮
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 新建聊天
newChatBtn.addEventListener('click', () => {
  if (isGenerating) return;
  // 停止 TTS
  if (ttsPlaying) stopTTS();
  // 先保存当前会话
  saveCurrentChat();
  // 重置状态
  pageContent = '';
  pageExcerpt = '';
  pageTitle = '';
  conversationHistory = [];
  currentChatId = null;
  updateQuotePreview('');
  chatArea.innerHTML = '<div class="welcome-msg"><p>打开任意网页，点击上方按钮或输入问题开始使用。</p></div>';
});

// 导出当前聊天
exportBtn.addEventListener('click', () => {
  const messages = getDisplayMessages();
  if (messages.length === 0) return;
  exportChatAsMarkdown({
    title: generateTitle(messages),
    messages,
    conversationHistory,
    pageTitle
  });
});

// 历史面板
historyBtn.addEventListener('click', () => {
  renderHistoryList();
  historyPanel.classList.remove('hidden');
});

historyBackBtn.addEventListener('click', () => {
  historyPanel.classList.add('hidden');
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
  if (commandPopupOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        commandSelectedIndex = (commandSelectedIndex + 1) % filtered.length;
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        commandSelectedIndex = (commandSelectedIndex - 1 + filtered.length) % filtered.length;
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filtered = getFilteredCommands(userInput.value);
      if (filtered.length > 0) {
        executeQuickCommand(filtered[commandSelectedIndex]);
      } else {
        hideCommandPopup();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideCommandPopup();
      return;
    }
  } else {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
});

// 输入框自动调整高度 + 快捷指令检测
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';

  const value = userInput.value;
  if (value.startsWith('/')) {
    updateCommandPopup(value);
  } else if (commandPopupOpen) {
    hideCommandPopup();
  }
});

// === 快捷指令弹出列表 ===（已拆分至 quick-commands.js）

// 监听选区变化消息（经由 service_worker 中转）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'selectionChanged') {
    // 只处理当前关联 tab 的消息
    if (activeTabId && msg.tabId && msg.tabId !== activeTabId) return;
    updateQuotePreview(msg.text);
  }
});

// 更新引用预览 UI
function updateQuotePreview(text) {
  selectedText = text;
  if (text) {
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    quoteText.textContent = truncated;
    quotePreview.classList.remove('hidden');
  } else {
    quoteText.textContent = '';
    quotePreview.classList.add('hidden');
  }
}

// 清除引用按钮
quoteClose.addEventListener('click', () => {
  updateQuotePreview('');
});

// === 历史对话管理 ===（已拆分至 chat-history.js）

// === 核心功能 ===

// 提取当前页面内容
async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
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

  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts = {
    summarize: hasSelection
      ? '请总结用户引用的这段内容。要求：\n1. 用 3-5 个要点概括核心内容\n2. 保持客观，不添加原文没有的信息\n3. 语言简洁明了'
      : '请总结这篇网页内容。要求：\n1. 用 3-5 个要点概括核心内容\n2. 保持客观，不添加原文没有的信息\n3. 语言简洁明了',
    translate: hasSelection
      ? '请将用户引用的这段内容翻译为中文。要求：\n1. 准确传达原文含义\n2. 语言通顺自然\n3. 专业术语保留英文并附上中文解释'
      : '请将这篇网页内容翻译为中文。要求：\n1. 准确传达原文含义\n2. 语言通顺自然\n3. 专业术语保留英文并附上中文解释',
    keyInfo: hasSelection
      ? '请提取用户引用的这段内容的关键信息。要求：\n1. 列出所有重要的事实、数据、观点\n2. 按重要性排序\n3. 每条信息简洁明了'
      : '请提取这篇网页内容的关键信息。要求：\n1. 列出所有重要的事实、数据、观点\n2. 按重要性排序\n3. 每条信息简洁明了'
  };

  const actionNames = {
    summarize: '总结',
    translate: '翻译',
    keyInfo: '提取关键信息'
  };

  await sendToAI(actionPrompts[action], actionNames[action]);
}

// 核心发送逻辑（统一入口）
async function sendToAI(text, displayText) {
  const quoteForContext = selectedText;

  // 显示用户消息
  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    appendMessageWithQuote(truncated, displayText);
    updateQuotePreview('');
  } else {
    appendMessage('user', displayText);
  }

  try {
    // 每次发送消息都重新提取页面内容，确保获取最新内容
    await extractPageContent();

    // 构建消息列表（带页面上下文）
    const messages = [];
    if (pageContent) {
      const context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);

      messages.push({
        role: 'system',
        content: `你是一个 AI 阅读助手。用户正在阅读一篇网页文章，以下是文章内容，请基于这些内容回答用户的问题。

文章标题：${pageTitle}

文章内容：
${context}`
      });

      if (customSystemPrompt) {
        messages.push({ role: 'system', content: customSystemPrompt });
      }
    }

    // 加入历史对话
    messages.push(...conversationHistory);

    // 构建当前用户消息（引用内容合并到用户消息中）
    let userContent = text;
    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, '\n\n[引用内容过长，已截断]');
      userContent = `以下是用户从页面中引用的内容：\n\n${quote}\n\n${text}`;
    }
    conversationHistory.push({ role: 'user', content: userContent });
    messages.push({ role: 'user', content: userContent });

    await callAI(messages);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
  }
}

// 自由问答发送
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isGenerating) return;

  userInput.value = '';
  userInput.style.height = 'auto';
  await sendToAI(text, text);
}

// 调用 AI（统一入口）
async function callAI(messages) {
  // 停止正在播放的 TTS
  if (ttsPlaying) stopTTS();

  isGenerating = true;
  setButtonsDisabled(true);

  const msgEl = appendMessage('ai', '');
  const typingEl = addTypingIndicator(msgEl);
  let fullText = '';
  let thinkingText = '';
  let thinkingEl = null;
  let thinkingContentEl = null;
  let contentEl = null;

  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({
    type: 'chat',
    messages: messages
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'thinking') {
      thinkingText += msg.content;
      removeTypingIndicator(typingEl);

      if (!thinkingEl) {
        thinkingEl = document.createElement('details');
        thinkingEl.className = 'thinking-block';
        thinkingEl.open = true;
        const summary = document.createElement('summary');
        summary.className = 'thinking-summary';
        summary.textContent = '思考过程';
        thinkingEl.appendChild(summary);
        thinkingContentEl = document.createElement('div');
        thinkingContentEl.className = 'thinking-content';
        thinkingEl.appendChild(thinkingContentEl);
        msgEl.appendChild(thinkingEl);
      }

      thinkingContentEl.innerHTML = marked.parse(thinkingText);
      smartScrollToBottom();
    } else if (msg.type === 'chunk') {
      // 思考结束后折叠思考区块
      if (thinkingEl) {
        thinkingEl.open = false;
        thinkingEl = null;
      }

      fullText += msg.content;
      removeTypingIndicator(typingEl);

      if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'thinking-response-content';
        msgEl.appendChild(contentEl);
      }

      contentEl.innerHTML = marked.parse(fullText);
      smartScrollToBottom();
    } else if (msg.type === 'done') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      conversationHistory.push({ role: 'assistant', content: fullText });
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
      // 添加 TTS 按钮
      addTTSButton(msgEl);
      // 自动保存
      saveCurrentChat();
    } else if (msg.type === 'error') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      msgEl.innerHTML = `<span style="color:#dc2626">${msg.error}</span>`;
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
    }
  });
}

// === UI 辅助函数 ===（已拆分至 ui-helpers.js）

// === TTS 语音合成 ===

function stopTTS() {
  ttsPlaying = false;
  ttsDone = true;

  if (ttsCurrentSource) {
    try { ttsCurrentSource.stop(); } catch {}
    ttsCurrentSource = null;
  }
  if (ttsAudioCtx) {
    try { ttsAudioCtx.close(); } catch {}
    ttsAudioCtx = null;
  }
  if (ttsPort) {
    try { ttsPort.disconnect(); } catch {}
    ttsPort = null;
  }

  // 恢复按钮状态
  const btn = chatArea.querySelector('.tts-btn');
  if (btn) {
    btn.classList.remove('tts-playing', 'tts-loading');
  }
}

function playTTS(text) {
  // 如果正在播放，先停止
  if (ttsPlaying) {
    stopTTS();
    return;
  }

  console.log('[TTS] playTTS called, text length:', text.length);
  ttsPlaying = true;
  ttsDone = false;

  const btn = chatArea.querySelector('.tts-btn');
  if (btn) btn.classList.add('tts-loading');

  // 收集所有 chunk 的 base64 数据，完成后一次性解码播放
  let chunks = [];

  ttsPort = chrome.runtime.connect({ name: 'tts' });
  console.log('[TTS] port connected');

  ttsPort.onDisconnect.addListener(() => {
    console.log('[TTS] port disconnected');
    if (ttsPlaying) stopTTS();
  });

  ttsPort.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      if (!msg.data) return;
      chunks.push(msg.data);
      console.log('[TTS] chunk received, total chunks:', chunks.length);
    } else if (msg.type === 'done') {
      console.log('[TTS] done, total chunks:', chunks.length, 'total base64 length:', chunks.join('').length);
      ttsDone = true;
      if (chunks.length === 0) {
        console.log('[TTS] no chunks received, stopping');
        stopTTS();
        return;
      }

      // 拼接所有 base64 chunk → 完整的 mp3 二进制
      const fullBase64 = chunks.join('');
      const binaryStr = atob(fullBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      console.log('[TTS] decoded binary, size:', bytes.length, 'bytes');

      ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      ttsAudioCtx.resume().then(() => {
        console.log('[TTS] AudioContext resumed, decoding...');
        return ttsAudioCtx.decodeAudioData(bytes.buffer);
      }).then((audioBuffer) => {
        console.log('[TTS] decoded audio, duration:', audioBuffer.duration, 's');
        if (!ttsPlaying) return; // 用户已经停止了
        if (btn) {
          btn.classList.remove('tts-loading');
          btn.classList.add('tts-playing');
        }

        const source = ttsAudioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ttsAudioCtx.destination);
        ttsCurrentSource = source;

        source.onended = () => {
          ttsCurrentSource = null;
          stopTTS();
        };

        source.start();
        console.log('[TTS] playback started');
      }).catch((err) => {
        console.error('[TTS] 音频解码失败:', err);
        stopTTS();
      });

    } else if (msg.type === 'error') {
      console.error('[TTS] error:', msg.error);
      stopTTS();
    }
  });

  ttsPort.postMessage({ type: 'tts', text });
  console.log('[TTS] message sent to service worker');
}

function addTTSButton(msgEl) {
  // 移除之前的 TTS 按钮
  const prev = chatArea.querySelector('.tts-btn');
  if (prev) prev.remove();

  const btn = document.createElement('button');
  btn.className = 'tts-btn';
  btn.title = '朗读';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

  btn.addEventListener('click', () => {
    // 从 msgEl 提取文本内容（优先取 thinking-response-content 或整体文本）
    const contentEl = msgEl.querySelector('.thinking-response-content');
    const text = contentEl ? contentEl.textContent : msgEl.textContent;
    if (text && text.trim()) {
      playTTS(text.trim());
    }
  });

  msgEl.appendChild(btn);
}

// === 模型状态栏 ===

const modelStatusBar = document.getElementById('modelStatusBar');

function updateModelStatusBar(name) {
  modelStatusBar.textContent = '当前模型：' + (name || 'deepseek-chat');
}

// 加载时读取模型名称
chrome.storage.sync.get(['modelName'], (data) => {
  updateModelStatusBar(data.modelName);
});

// 监听模型名称变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.modelName) {
      updateModelStatusBar(changes.modelName.newValue);
    }
    if (changes.systemPrompt) {
      customSystemPrompt = changes.systemPrompt.newValue || '';
    }
  }
});
