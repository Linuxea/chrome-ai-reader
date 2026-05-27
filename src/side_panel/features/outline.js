// features/outline.js — 智能大纲功能

import { t } from '../../shared/i18n.js';
import { TRUNCATE_LIMITS, safeTruncate, escapeHtml } from '../../shared/constants.js';
import { stripMarkdownFence } from '../../shared/json-repair.js';
import { marked } from 'marked';
import * as state from '../state.js';
import { emit, EVENTS } from '../events.js';
import { appendMessage, scrollToBottom, setButtonsDisabled } from '../ui/dom-helpers.js';
import { stopTTS } from '../services/tts/index.js';

let _extractPageContent;

export function initOutline(deps) {
  _extractPageContent = deps.onExtractPageContent;
}

// === 1. parseOutlineResponse(rawText) ===
// Parse AI JSON response into outline data object.
// Returns the parsed object on success, null on failure.

export function parseOutlineResponse(rawText) {
  if (!rawText) return null;

  // Try direct parse
  try {
    const data = JSON.parse(rawText);
    if (data && data.title && data.sections) return data;
  } catch { /* not direct JSON — try stripped version next */ }

  // Try parse on trimmed text (strip leading/trailing whitespace or markdown fences)
  try {
    const trimmed = stripMarkdownFence(rawText);
    const data = JSON.parse(trimmed);
    if (data && data.title && data.sections) return data;
  } catch { /* not valid outline JSON — return null */ }

  return null;
}

// === 2. outlineToMarkdown(data) ===
// Convert outline JSON to a Markdown string.

export function outlineToMarkdown(data) {
  if (!data) return '';
  let md = '# ' + data.title + '\n\n';
  if (data.sections && data.sections.length > 0) {
    data.sections.forEach(function(section) {
      md += sectionToMarkdown(section, 2);
    });
  }
  return md.trim();
}

export function sectionToMarkdown(section, level) {
  let prefix = '';
  for (let i = 0; i < level; i++) prefix += '#';
  let md = prefix + ' ' + section.heading + '\n\n';

  if (section.summary) {
    md += section.summary + '\n\n';
  }

  if (section.data && section.data.length > 0) {
    section.data.forEach(function(item) {
      md += '- ' + item + '\n';
    });
    md += '\n';
  }

  if (section.quote) {
    md += '> ' + section.quote.replace(/\n/g, '\n> ') + '\n\n';
  }

  if (section.children && section.children.length > 0) {
    section.children.forEach(function(child) {
      md += sectionToMarkdown(child, level + 1);
    });
  }

  return md;
}

// === 3. renderOutlineNode(section) ===
// Create DOM for one tree node.

function renderOutlineNode(section) {
  const node = document.createElement('div');
  node.className = 'outline-node';

  // Heading row with arrow
  const heading = document.createElement('div');
  heading.className = 'outline-heading';

  const arrow = document.createElement('span');
  arrow.className = 'outline-arrow';
  arrow.textContent = '\u25B6'; // ▶

  const headingText = document.createElement('span');
  headingText.className = 'outline-heading-text';
  headingText.textContent = section.heading;

  heading.appendChild(arrow);
  heading.appendChild(headingText);

  // Click toggles expanded class
  heading.addEventListener('click', function() {
    node.classList.toggle('expanded');
  });

  node.appendChild(heading);

  // Knowledge card
  const card = document.createElement('div');
  card.className = 'outline-card';

  // Summary section
  if (section.summary) {
    const summarySection = document.createElement('div');
    summarySection.className = 'outline-card-section';
    const summaryLabel = document.createElement('div');
    summaryLabel.className = 'outline-card-label';
    summaryLabel.textContent = t('outline.label.summary');
    const summaryText = document.createElement('div');
    summaryText.className = 'outline-card-summary';
    summaryText.textContent = section.summary;
    summarySection.appendChild(summaryLabel);
    summarySection.appendChild(summaryText);
    card.appendChild(summarySection);
  }

  // Key data section
  if (section.data && section.data.length > 0) {
    const dataSection = document.createElement('div');
    dataSection.className = 'outline-card-section';
    const dataLabel = document.createElement('div');
    dataLabel.className = 'outline-card-label';
    dataLabel.textContent = t('outline.label.data');
    const dataList = document.createElement('ul');
    dataList.className = 'outline-card-data';
    section.data.forEach(function(item) {
      const li = document.createElement('li');
      li.textContent = item;
      dataList.appendChild(li);
    });
    dataSection.appendChild(dataLabel);
    dataSection.appendChild(dataList);
    card.appendChild(dataSection);
  }

  // Quote section
  if (section.quote) {
    const quoteSection = document.createElement('div');
    quoteSection.className = 'outline-card-section';
    const quoteLabel = document.createElement('div');
    quoteLabel.className = 'outline-card-label';
    quoteLabel.textContent = t('outline.label.quote');
    const quoteBlock = document.createElement('blockquote');
    quoteBlock.className = 'outline-card-quote';
    quoteBlock.textContent = section.quote;
    quoteSection.appendChild(quoteLabel);
    quoteSection.appendChild(quoteBlock);
    card.appendChild(quoteSection);
  }

  node.appendChild(card);

  // Children container (indented)
  if (section.children && section.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'outline-children';
    section.children.forEach(function(child) {
      childrenContainer.appendChild(renderOutlineNode(child));
    });
    node.appendChild(childrenContainer);
  }

  return node;
}

// === 4. renderOutline(data) ===
// Create full outline container DOM.

function renderOutline(data) {
  const container = document.createElement('div');
  container.className = 'outline-container';

  // Header with title
  const header = document.createElement('div');
  header.className = 'outline-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'outline-title-text';
  titleSpan.textContent = t('outline.title') + ' ' + data.title;
  header.appendChild(titleSpan);
  container.appendChild(header);

  // Sections
  if (data.sections && data.sections.length > 0) {
    data.sections.forEach(function(section) {
      container.appendChild(renderOutlineNode(section));
    });
  }

  // Footer with Copy and Export buttons
  const footer = document.createElement('div');
  footer.className = 'outline-footer';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'outline-action-btn';
  copyBtn.textContent = t('outline.copy');
  copyBtn.addEventListener('click', function() {
    const md = outlineToMarkdown(data);
    navigator.clipboard.writeText(md).then(function() {
      copyBtn.textContent = t('outline.copySuccess');
      setTimeout(function() {
        copyBtn.textContent = t('outline.copy');
      }, 1500);
    }).catch(function() {
      // clipboard write failed — silently ignore
    });
  });

  const exportBtn = document.createElement('button');
  exportBtn.className = 'outline-action-btn';
  exportBtn.textContent = t('outline.export');
  exportBtn.addEventListener('click', function() {
    const md = outlineToMarkdown(data);
    const now = new Date();
    const dateStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    downloadFile(md, t('outline.title') + '_' + dateStr + '.md', 'text/markdown;charset=utf-8');
  });

  footer.appendChild(copyBtn);
  footer.appendChild(exportBtn);
  container.appendChild(footer);

  return container;
}

// === 5. renderOutlineSkeleton() ===
// Shimmer skeleton placeholder.

function renderOutlineSkeleton() {
  const skeleton = document.createElement('div');
  skeleton.className = 'outline-skeleton';
  for (let i = 0; i < 5; i++) {
    const line = document.createElement('div');
    line.className = 'outline-skeleton-line';
    skeleton.appendChild(line);
  }
  return skeleton;
}

// === 6. generateOutline() ===
// Main entry point.

export function generateOutline() {
  if (state.getIsGenerating()) return;

  const pageContent = state.getPageContent();

  if (!pageContent) {
    _extractPageContent().then(function() {
      // Re-check isGenerating — user may have started another operation during the async extract
      if (state.getIsGenerating()) return;
      if (!state.getPageContent()) {
        appendMessage('error', t('outline.noContent'));
        return;
      }
      if (state.getPageContent().trim().length < 200) {
        appendMessage('error', t('outline.tooShort'));
        return;
      }
      doGenerateOutline();
    }).catch(function() {
      appendMessage('error', t('outline.noContent'));
    });
    return;
  }

  if (pageContent.trim().length < 200) {
    appendMessage('error', t('outline.tooShort'));
    return;
  }

  doGenerateOutline();
}

// === 7. doGenerateOutline() ===
// Actual implementation.

function doGenerateOutline() {
  state.setIsGenerating(true);
  setButtonsDisabled(true);

  stopTTS();
  emit(EVENTS.REMOVE_SUGGEST_QUESTIONS);

  // Remove welcome message
  const chatArea = document.getElementById('chatArea');
  const welcome = chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  // Create AI bubble with skeleton
  const msgEl = appendMessage('ai', '');
  msgEl.appendChild(renderOutlineSkeleton());
  scrollToBottom();

  // Build messages — standalone request, no conversation history
  const messages = [];
  const context = safeTruncate(state.getPageContent(), TRUNCATE_LIMITS.CONTEXT);
  messages.push({ role: 'system', content: t('prompt.outline') });

  const customSystemPrompt = state.getCustomSystemPrompt();
  if (customSystemPrompt) {
    messages.push({ role: 'system', content: customSystemPrompt });
  }

  messages.push({ role: 'user', content: context });

  // Connect to ai-chat port with response_format for JSON output
  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({
    type: 'chat',
    messages: messages,
    response_format: { type: 'json_object' }
  });

  // Safety net: reset lock if port disconnects unexpectedly
  port.onDisconnect.addListener(function() {
    if (state.getIsGenerating()) {
      if (!fullText) {
        msgEl.className = 'message message-error';
        msgEl.innerHTML = escapeHtml(t('error.apiFailed'));
      }
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
  });

  let fullText = '';

  port.onMessage.addListener(function(msg) {
    if (msg.type === 'thinking') {
      // Ignore thinking chunks for outline — not useful in structured view
    } else if (msg.type === 'chunk') {
      fullText += msg.content;
    } else if (msg.type === 'done') {
      port.disconnect();

      // Clear skeleton
      msgEl.innerHTML = '';

      const data = parseOutlineResponse(fullText);
      if (data) {
        const outlineEl = renderOutline(data);
        msgEl.appendChild(outlineEl);
        msgEl.dataset.type = 'outline';
        msgEl.dataset.json = fullText;
        state.pushConversation({ role: 'user', content: '[大纲请求] ' + context.slice(0, 100) });
        state.pushConversation({ role: 'assistant', content: fullText, type: 'outline' });
      } else {
        // Fallback to Markdown rendering
        msgEl.innerHTML = marked.parse(fullText);
        state.pushConversation({ role: 'assistant', content: fullText });
      }

      state.setIsGenerating(false);
      setButtonsDisabled(false);
      emit(EVENTS.ADD_TTS_BUTTON, { msgEl });
      emit(EVENTS.SAVE_CURRENT_CHAT);
      scrollToBottom();
    } else if (msg.type === 'error') {
      port.disconnect();
      const errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || '');
      msgEl.className = 'message message-error';
      msgEl.innerHTML = escapeHtml(errorText);
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
  });
}

// === 8. renderOutlineFromJSON(jsonString) ===
// For chat history restore.

export function renderOutlineFromJSON(jsonString) {
  const data = parseOutlineResponse(jsonString);
  if (!data) return null;
  return renderOutline(data);
}
