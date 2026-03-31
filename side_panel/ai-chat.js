// ai-chat.js — 核心对话逻辑（页面提取、快捷操作、AI 调用、消息发送）

async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
  if (!tab) throw new Error(t('error.noTab'));

  const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
  if (!response?.success) {
    throw new Error(response?.error || t('error.extractFailed'));
  }

  pageContent = response.data.textContent;
  pageExcerpt = response.data.excerpt;
  pageTitle = response.data.title;

  return response.data;
}

async function handleQuickAction(action) {
  if (isGenerating) return;

  if (action === 'outline') {
    generateOutline();
    return;
  }

  if (ocrRunning > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  if (hasImageErrors()) {
    appendMessage('error', t('error.ocrPartialFail'));
    return;
  }

  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts = {
    summarize: hasSelection ? t('prompt.summarize.quote') : t('prompt.summarize.full'),
    translate: hasSelection ? t('prompt.translate.quote') : t('prompt.translate.full'),
    keyInfo: hasSelection ? t('prompt.keyInfo.quote') : t('prompt.keyInfo.full')
  };

  const actionNames = {
    summarize: t('action.summarize'),
    translate: t('action.translate'),
    keyInfo: t('action.keyInfo')
  };

  const ocrContext = buildOcrContext();
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await sendToAI(actionPrompts[action], actionNames[action], undefined, ocrContext, imageUris);
}

async function sendToAI(text, displayText, retryQuote, ocrContext, imageUris) {
  removeSuggestQuestions();
  const quoteForContext = retryQuote || selectedText;

  if (quoteForContext) {
    const truncated = quoteForContext.length > 50
      ? quoteForContext.slice(0, 50) + '...'
      : quoteForContext;
    const userMsgEl = appendMessageWithQuote(truncated, displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawQuote = quoteForContext;
    userMsgEl.dataset.rawDisplay = displayText;
    updateQuotePreview('');
  } else {
    const userMsgEl = appendMessage('user', displayText, imageUris);
    userMsgEl.dataset.rawText = text;
    userMsgEl.dataset.rawDisplay = displayText;
  }

  try {
    await extractPageContent();

    const messages = [];
    if (pageContent) {
      const context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);

      const systemContent = t('prompt.default', { title: pageTitle, content: context });
      messages.push({
        role: 'system',
        content: systemContent
      });

      if (customSystemPrompt) {
        messages.push({ role: 'system', content: customSystemPrompt });
      }
    }

    messages.push(...conversationHistory);

    let historyContent = text;
    let apiContent = text;

    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
      const withQuote = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
      historyContent = withQuote;
      apiContent = withQuote;
    }

    conversationHistory.push({ role: 'user', content: historyContent });

    if (ocrContext) {
      apiContent = apiContent + '\n\n' + ocrContext;
    }
    messages.push({ role: 'user', content: apiContent });

    await callAI(messages);
  } catch (e) {
    removeLastMessage();
    appendMessage('error', e.message);
  }
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isGenerating) return;

  if (ocrRunning > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  if (hasImageErrors()) {
    appendMessage('error', t('error.ocrPartialFail'));
    return;
  }

  userInput.value = '';
  userInput.style.height = 'auto';

  const ocrContext = buildOcrContext();
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await sendToAI(text, text, undefined, ocrContext, imageUris);
}

async function retryMessage(wrapper, rawText, rawDisplay, rawQuote) {
  if (isGenerating) return;

  if (ttsPlaying) stopTTS();
  removeSuggestQuestions();

  const children = [...chatArea.children];
  let found = false;
  for (const child of children) {
    if (child === wrapper) found = true;
    if (found) child.remove();
  }

  const userContent = rawQuote
    ? t('ai.quotePrefix') + '\n\n' + safeTruncate(rawQuote, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated')) + '\n\n' + rawText
    : rawText;
  const idx = conversationHistory.findLastIndex(m => m.role === 'user' && m.content === userContent);
  if (idx !== -1) {
    conversationHistory.splice(idx);
  }

  await sendToAI(rawText, rawDisplay, rawQuote);
}

async function callAI(messages) {
  if (ttsPlaying) stopTTS();

  isGenerating = true;
  setButtonsDisabled(true);

  if (ttsAutoPlayEnabled) {
    initTTSPlayback();
  }

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
        summary.textContent = t('ai.thinking');
        thinkingEl.appendChild(summary);
        thinkingContentEl = document.createElement('div');
        thinkingContentEl.className = 'thinking-content';
        thinkingEl.appendChild(thinkingContentEl);
        msgEl.appendChild(thinkingEl);
      }

      thinkingContentEl.innerHTML = marked.parse(thinkingText);
      smartScrollToBottom();
    } else if (msg.type === 'chunk') {
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
      if (ttsAutoPlayEnabled) {
        ttsAppendChunk(msg.content);
      }
    } else if (msg.type === 'done') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      conversationHistory.push({ role: 'assistant', content: fullText });
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
      addTTSButton(msgEl);
      initTTSAutoPlay(msgEl);
      saveCurrentChat();
      generateSuggestions(msgEl, conversationHistory);
    } else if (msg.type === 'error') {
      removeTypingIndicator(typingEl);
      if (thinkingEl) thinkingEl.open = false;
      const errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || '');
      msgEl.innerHTML = `<span style="color:var(--error-text)">${errorText}</span>`;
      isGenerating = false;
      setButtonsDisabled(false);
      port.disconnect();
    }
  });
}
