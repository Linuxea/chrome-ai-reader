// outline.js — 智能大纲功能

(function() {
  'use strict';

  // === 1. parseOutlineResponse(rawText) ===
  // Parse AI JSON response into outline data object.
  // Returns the parsed object on success, null on failure.

  function parseOutlineResponse(rawText) {
    if (!rawText) return null;

    // Try direct parse
    try {
      var data = JSON.parse(rawText);
      if (data && data.title && data.sections) return data;
    } catch (e) {}

    // Try parse on trimmed text (strip leading/trailing whitespace or markdown fences)
    try {
      var trimmed = rawText.trim();
      // Strip possible ```json ... ``` wrapper
      if (trimmed.startsWith('```')) {
        var firstNewline = trimmed.indexOf('\n');
        if (firstNewline !== -1) {
          trimmed = trimmed.slice(firstNewline + 1);
        }
        if (trimmed.endsWith('```')) {
          trimmed = trimmed.slice(0, -3);
        }
        trimmed = trimmed.trim();
      }
      var data = JSON.parse(trimmed);
      if (data && data.title && data.sections) return data;
    } catch (e) {}

    return null;
  }

  // === 2. outlineToMarkdown(data) ===
  // Convert outline JSON to a Markdown string.

  function outlineToMarkdown(data) {
    if (!data) return '';
    var md = '# ' + data.title + '\n\n';
    if (data.sections && data.sections.length > 0) {
      data.sections.forEach(function(section) {
        md += sectionToMarkdown(section, 2);
      });
    }
    return md.trim();
  }

  function sectionToMarkdown(section, level) {
    var prefix = '';
    for (var i = 0; i < level; i++) prefix += '#';
    var md = prefix + ' ' + section.heading + '\n\n';

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
    var node = document.createElement('div');
    node.className = 'outline-node';

    // Heading row with arrow
    var heading = document.createElement('div');
    heading.className = 'outline-heading';

    var arrow = document.createElement('span');
    arrow.className = 'outline-arrow';
    arrow.textContent = '\u25B6'; // ▶

    var headingText = document.createElement('span');
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
    var card = document.createElement('div');
    card.className = 'outline-card';

    // Summary section
    if (section.summary) {
      var summarySection = document.createElement('div');
      summarySection.className = 'outline-card-section';
      var summaryLabel = document.createElement('div');
      summaryLabel.className = 'outline-card-label';
      summaryLabel.textContent = t('outline.label.summary');
      var summaryText = document.createElement('div');
      summaryText.className = 'outline-card-summary';
      summaryText.textContent = section.summary;
      summarySection.appendChild(summaryLabel);
      summarySection.appendChild(summaryText);
      card.appendChild(summarySection);
    }

    // Key data section
    if (section.data && section.data.length > 0) {
      var dataSection = document.createElement('div');
      dataSection.className = 'outline-card-section';
      var dataLabel = document.createElement('div');
      dataLabel.className = 'outline-card-label';
      dataLabel.textContent = t('outline.label.data');
      var dataList = document.createElement('ul');
      dataList.className = 'outline-card-data';
      section.data.forEach(function(item) {
        var li = document.createElement('li');
        li.textContent = item;
        dataList.appendChild(li);
      });
      dataSection.appendChild(dataLabel);
      dataSection.appendChild(dataList);
      card.appendChild(dataSection);
    }

    // Quote section
    if (section.quote) {
      var quoteSection = document.createElement('div');
      quoteSection.className = 'outline-card-section';
      var quoteLabel = document.createElement('div');
      quoteLabel.className = 'outline-card-label';
      quoteLabel.textContent = t('outline.label.quote');
      var quoteBlock = document.createElement('blockquote');
      quoteBlock.className = 'outline-card-quote';
      quoteBlock.textContent = section.quote;
      quoteSection.appendChild(quoteLabel);
      quoteSection.appendChild(quoteBlock);
      card.appendChild(quoteSection);
    }

    node.appendChild(card);

    // Children container (indented)
    if (section.children && section.children.length > 0) {
      var childrenContainer = document.createElement('div');
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
    var container = document.createElement('div');
    container.className = 'outline-container';

    // Header with title
    var header = document.createElement('div');
    header.className = 'outline-header';
    var titleSpan = document.createElement('span');
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
    var footer = document.createElement('div');
    footer.className = 'outline-footer';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'outline-action-btn';
    copyBtn.textContent = t('outline.copy');
    copyBtn.addEventListener('click', function() {
      var md = outlineToMarkdown(data);
      navigator.clipboard.writeText(md).then(function() {
        copyBtn.textContent = t('outline.copySuccess');
        setTimeout(function() {
          copyBtn.textContent = t('outline.copy');
        }, 1500);
      });
    });

    var exportBtn = document.createElement('button');
    exportBtn.className = 'outline-action-btn';
    exportBtn.textContent = t('outline.export');
    exportBtn.addEventListener('click', function() {
      var md = outlineToMarkdown(data);
      var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var now = new Date();
      var dateStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      a.href = url;
      a.download = t('outline.title') + '_' + dateStr + '.md';
      a.click();
      URL.revokeObjectURL(url);
    });

    footer.appendChild(copyBtn);
    footer.appendChild(exportBtn);
    container.appendChild(footer);

    return container;
  }

  // === 5. renderOutlineSkeleton() ===
  // Shimmer skeleton placeholder.

  function renderOutlineSkeleton() {
    var skeleton = document.createElement('div');
    skeleton.className = 'outline-skeleton';
    for (var i = 0; i < 5; i++) {
      var line = document.createElement('div');
      line.className = 'outline-skeleton-line';
      skeleton.appendChild(line);
    }
    return skeleton;
  }

  // === 6. generateOutline() ===
  // Main entry point called by side_panel.js.

  function generateOutline() {
    if (isGenerating) return;

    if (!pageContent) {
      extractPageContent().then(function() {
        if (!pageContent || pageContent.trim().length < 200) {
          appendMessage('error', t('outline.noContent'));
          return;
        }
        doGenerateOutline();
      }).catch(function() {
        appendMessage('error', t('outline.noContent'));
      });
      return;
    }

    if (pageContent.trim().length < 200) {
      appendMessage('error', t('outline.noContent'));
      return;
    }

    doGenerateOutline();
  }

  // === 7. doGenerateOutline() ===
  // Actual implementation.

  function doGenerateOutline() {
    isGenerating = true;
    setButtonsDisabled(true);

    if (ttsPlaying) stopTTS();
    removeSuggestQuestions();

    // Remove welcome message
    var welcome = chatArea.querySelector('.welcome-msg');
    if (welcome) welcome.remove();

    // Create AI bubble with skeleton
    var msgEl = appendMessage('ai', '');
    msgEl.appendChild(renderOutlineSkeleton());
    scrollToBottom();

    // Build messages
    var messages = [];
    var context = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);
    var systemContent = t('prompt.outline');
    messages.push({ role: 'system', content: systemContent });

    if (customSystemPrompt) {
      messages.push({ role: 'system', content: customSystemPrompt });
    }

    messages.push(...conversationHistory);

    var userContent = safeTruncate(pageContent, TRUNCATE_LIMITS.CONTEXT);
    conversationHistory.push({ role: 'user', content: userContent });
    messages.push({ role: 'user', content: userContent });

    // Connect to ai-chat port with response_format for JSON output
    var port = chrome.runtime.connect({ name: 'ai-chat' });

    port.postMessage({
      type: 'chat',
      messages: messages,
      response_format: { type: 'json_object' }
    });

    var fullText = '';

    port.onMessage.addListener(function(msg) {
      if (msg.type === 'thinking') {
        // Ignore thinking chunks for outline — not useful in structured view
      } else if (msg.type === 'chunk') {
        fullText += msg.content;
      } else if (msg.type === 'done') {
        port.disconnect();

        // Clear skeleton
        msgEl.innerHTML = '';

        var data = parseOutlineResponse(fullText);
        if (data) {
          var outlineEl = renderOutline(data);
          msgEl.appendChild(outlineEl);
          msgEl.dataset.type = 'outline';
          msgEl.dataset.json = fullText;
          conversationHistory.push({ role: 'assistant', content: fullText, type: 'outline' });
        } else {
          // Fallback to Markdown rendering
          msgEl.innerHTML = marked.parse(fullText);
          conversationHistory.push({ role: 'assistant', content: fullText });
        }

        isGenerating = false;
        setButtonsDisabled(false);
        addTTSButton(msgEl);
        saveCurrentChat();
        scrollToBottom();
      } else if (msg.type === 'error') {
        port.disconnect();
        var errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || '');
        msgEl.innerHTML = '<span style="color:var(--error-text)">' + escapeHtml(errorText) + '</span>';
        isGenerating = false;
        setButtonsDisabled(false);
      }
    });
  }

  // === 8. renderOutlineFromJSON(jsonString) ===
  // For chat history restore.

  function renderOutlineFromJSON(jsonString) {
    var data = parseOutlineResponse(jsonString);
    if (!data) return null;
    return renderOutline(data);
  }

  // === Expose to global ===
  window.generateOutline = generateOutline;
  window.renderOutlineFromJSON = renderOutlineFromJSON;
  window.outlineToMarkdown = outlineToMarkdown;
})();
