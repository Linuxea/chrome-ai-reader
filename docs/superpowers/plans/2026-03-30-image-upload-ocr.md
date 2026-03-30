# Image Upload + OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image upload button to chat input, OCR each image via Zhipu GLM-OCR, store results in memory for future use.

**Architecture:** Paperclip button in input area triggers native file picker. Selected images get thumbnails in a preview bar above the input. Each image is sent to the existing `ocrParse` service worker handler. Results stored in `ocrResults` array. This iteration does NOT append OCR text to AI messages — only the UI + OCR plumbing.

**Tech Stack:** Vanilla JS, Chrome Extension APIs (runtime.sendMessage), Zhipu GLM-OCR API (already proxied in service_worker.js)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `side_panel/side_panel.html` | Add imagePreviewBar div, upload button, hidden file input |
| `side_panel/side_panel.css` | Style preview bar, thumbnails, upload button |
| `side_panel/side_panel.js` | Upload handler, OCR calling, state management, cleanup |
| `CLAUDE.md` | Document new state variables and flow |

---

### Task 1: Add HTML elements to side_panel.html

**Files:**
- Modify: `side_panel/side_panel.html`

- [ ] **Step 1: Add imagePreviewBar and upload button + file input**

In `side_panel.html`, make two additions:

**A)** Between `quotePreview` div (line 109) and `input-wrapper` div (line 110), add the image preview bar:

```html
      <div id="imagePreviewBar" class="image-preview-bar hidden"></div>
```

**B)** Inside `.input-wrapper`, before the `<textarea>` (line 112), add the upload button and hidden file input:

```html
        <button id="imageUploadBtn" class="icon-btn upload-btn" title="上传图片">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input type="file" id="imageFileInput" accept="image/*" multiple hidden>
```

The final `.input-area` section should look like:

```html
    <div class="input-area">
      <div id="quotePreview" class="quote-preview hidden">
        ...existing quote content...
      </div>
      <div id="imagePreviewBar" class="image-preview-bar hidden"></div>
      <div class="input-wrapper">
        <div id="commandPopup" class="command-popup hidden"></div>
        <button id="imageUploadBtn" class="icon-btn upload-btn" title="上传图片">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input type="file" id="imageFileInput" accept="image/*" multiple hidden>
        <textarea id="userInput" placeholder="输入问题，基于当前页面内容回答..." rows="1"></textarea>
        <button id="sendBtn" class="send-btn" title="发送">
          ...existing send icon...
        </button>
      </div>
      <div id="modelStatusBar" class="model-status-bar">当前模型：deepseek-chat</div>
    </div>
```

- [ ] **Step 2: Reload extension and verify**

Reload the extension in `chrome://extensions/`. Open the side panel. You should see a paperclip icon to the left of the textarea. It won't do anything yet, but it should be visible and styled like other icon buttons.

- [ ] **Step 3: Commit**

```bash
git add side_panel/side_panel.html
git commit -m "feat(ocr): add image upload button and preview bar HTML"
```

---

### Task 2: Add CSS styles for image preview bar and thumbnails

**Files:**
- Modify: `side_panel/side_panel.css`

- [ ] **Step 1: Add image preview bar styles**

After the `.quote-preview.hidden` block (line 565 in current file), add:

```css
/* ===== Image Preview Bar ===== */

.image-preview-bar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--primary-light);
  border-radius: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.image-preview-bar.hidden {
  display: none;
}

.image-preview-item {
  position: relative;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid var(--border);
  transition: border-color 0.2s ease;
}

.image-preview-item.done {
  border-color: var(--primary);
}

.image-preview-item.error {
  border-color: #e74c3c;
}

.image-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-status {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: white;
}

.image-status.loading {
  background: var(--text-secondary);
  animation: img-pulse 1s ease-in-out infinite;
}

.image-status.loading::after {
  content: '⏳';
  font-size: 10px;
}

.image-status.done {
  background: var(--primary);
}

.image-status.done::after {
  content: '✓';
  font-size: 10px;
}

.image-status.error {
  background: #e74c3c;
}

.image-status.error::after {
  content: '✗';
  font-size: 10px;
}

.image-remove {
  position: absolute;
  top: -4px;
  left: -4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  color: white;
  border: none;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.image-preview-item:hover .image-remove {
  display: flex;
}

.image-remove:hover {
  background: rgba(0,0,0,0.85);
}

@keyframes img-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* Upload button in input wrapper */
.upload-btn {
  flex-shrink: 0;
  padding: 4px;
  color: var(--text-secondary);
}

.upload-btn:hover {
  color: var(--primary);
}
```

- [ ] **Step 2: Reload extension and verify**

Reload the extension. The paperclip icon should look properly styled with hover effect. The preview bar is hidden by default so won't be visible yet.

- [ ] **Step 3: Commit**

```bash
git add side_panel/side_panel.css
git commit -m "feat(ocr): add image preview bar and thumbnail CSS styles"
```

---

### Task 3: Add state variables and DOM references in side_panel.js

**Files:**
- Modify: `side_panel/side_panel.js`

- [ ] **Step 1: Add DOM references**

After the existing DOM references block (after line 17 `const quoteClose = ...`), add:

```javascript
// 图片上传 + OCR
const imageUploadBtn = document.getElementById('imageUploadBtn');
const imageFileInput = document.getElementById('imageFileInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');
```

- [ ] **Step 2: Add state variables**

After the existing state variables block (after line 34 `let activeTabId = null;`), add:

```javascript
// OCR 结果（仅内存，不持久化）
let ocrResults = [];    // [{ index, fileName, text }]
let ocrRunning = 0;     // 正在进行中的 OCR 请求数
let imageIndex = 0;     // 自增索引，用于编号
```

- [ ] **Step 3: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat(ocr): add OCR state variables and DOM references"
```

---

### Task 4: Implement image upload and OCR calling logic

**Files:**
- Modify: `side_panel/side_panel.js`

- [ ] **Step 1: Add upload button click handler and OCR logic**

After the `quoteClose.addEventListener` block (after line 285 `updateQuotePreview('');`), add:

```javascript
// === 图片上传 + OCR ===

// 点击上传按钮 → 触发文件选择
imageUploadBtn.addEventListener('click', () => {
  imageFileInput.click();
});

// 文件选择后处理
imageFileInput.addEventListener('change', () => {
  const files = Array.from(imageFileInput.files);
  if (files.length === 0) return;
  imageFileInput.value = ''; // 重置，允许重复选择同一文件

  imagePreviewBar.classList.remove('hidden');

  files.forEach(file => {
    imageIndex++;
    const idx = imageIndex;
    const reader = new FileReader();

    reader.onload = (e) => {
      const dataUri = e.target.result;
      addImagePreview(idx, file.name, dataUri);
      runOCR(idx, file.name, dataUri);
    };

    reader.readAsDataURL(file);
  });
});

// 添加缩略图到预览栏
function addImagePreview(index, fileName, dataUri) {
  const item = document.createElement('div');
  item.className = 'image-preview-item';
  item.dataset.index = index;

  item.innerHTML = `
    <img src="${dataUri}" class="image-thumb" alt="${escapeHtml(fileName)}">
    <span class="image-status loading"></span>
    <button class="image-remove" title="移除">×</button>
  `;

  // 删除按钮
  item.querySelector('.image-remove').addEventListener('click', () => {
    item.remove();
    ocrResults = ocrResults.filter(r => r.index !== index);
    if (imagePreviewBar.children.length === 0) {
      imagePreviewBar.classList.add('hidden');
    }
  });

  imagePreviewBar.appendChild(item);
}

// 调用 OCR 识别
async function runOCR(index, fileName, dataUri) {
  ocrRunning++;
  const item = imagePreviewBar.querySelector(`[data-index="${index}"]`);
  const statusEl = item?.querySelector('.image-status');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'ocrParse',
      file: dataUri
    });

    if (response.success) {
      // 提取 OCR 文本（API 返回结构需要适配）
      const text = extractOcrText(response.data);
      ocrResults.push({ index, fileName, text });
      if (statusEl) {
        statusEl.className = 'image-status done';
      }
      if (item) item.classList.add('done');
    } else {
      if (statusEl) {
        statusEl.className = 'image-status error';
      }
      if (item) item.classList.add('error');
    }
  } catch (e) {
    if (statusEl) {
      statusEl.className = 'image-status error';
    }
    if (item) item.classList.add('error');
  } finally {
    ocrRunning--;
  }
}

// 从 OCR API 响应中提取纯文本
function extractOcrText(data) {
  if (!data) return '';
  // 如果响应有 content_list，拼接所有文本块
  if (data.content_list && Array.isArray(data.content_list)) {
    return data.content_list
      .map(item => item.text || '')
      .filter(t => t.trim())
      .join('\n');
  }
  // 兜底：尝试取 markdown 或 text 字段
  if (data.markdown) return data.markdown;
  if (data.text) return data.text;
  return JSON.stringify(data);
}

// 清理图片预览和 OCR 状态
function clearImagePreviews() {
  ocrResults = [];
  ocrRunning = 0;
  imageIndex = 0;
  imagePreviewBar.innerHTML = '';
  imagePreviewBar.classList.add('hidden');
}

// 构建 OCR 上下文字符串
function buildOcrContext() {
  if (ocrResults.length === 0) return '';
  // 按 index 排序
  const sorted = [...ocrResults].sort((a, b) => a.index - b.index);
  return sorted.map((r, i) => {
    return `第${i + 1}张图片的内容是：\n${r.text}`;
  }).join('\n\n');
}
```

- [ ] **Step 2: Reload extension and test upload**

Reload the extension. Click the paperclip icon → file picker should open. Select an image → a thumbnail with loading spinner should appear. Since the `ocrParse` handler needs a valid API key, without one it will show an error state on the thumbnail. That's expected.

- [ ] **Step 3: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat(ocr): implement image upload, preview thumbnails, and OCR calling"
```

---

### Task 5: Integrate OCR checks into send flow and new chat

**Files:**
- Modify: `side_panel/side_panel.js`

- [ ] **Step 1: Add OCR guards to sendMessage function**

In the `sendMessage()` function (around line 402), add OCR checks at the beginning:

```javascript
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isGenerating) return;

  // OCR 识别中，阻止发送
  if (ocrRunning > 0) {
    appendMessage('error', 'OCR 识别中，请稍候...');
    return;
  }

  // 有失败的 OCR 图片，阻止发送
  const errorItems = imagePreviewBar.querySelectorAll('.image-preview-item.error');
  if (errorItems.length > 0) {
    appendMessage('error', '部分图片 OCR 失败，请移除后重试');
    return;
  }

  userInput.value = '';
  userInput.style.height = 'auto';

  // 构建 OCR 上下文（本迭代仅打印到控制台，不追加到消息）
  const ocrContext = buildOcrContext();
  if (ocrContext) {
    console.log('[OCR Context]', ocrContext);
  }

  // 清理图片预览
  clearImagePreviews();

  await sendToAI(text, text);
}
```

- [ ] **Step 2: Clear image previews on new chat**

In the `newChatBtn.addEventListener('click', ...)` handler (around line 151), add `clearImagePreviews()` after the other reset calls:

```javascript
newChatBtn.addEventListener('click', () => {
  if (isGenerating) return;
  // 停止 TTS
  if (ttsPlaying) stopTTS();
  // 先保存当前会话
  saveCurrentChat();
  // 重置状态
  removeSuggestQuestions();
  pageContent = '';
  pageExcerpt = '';
  pageTitle = '';
  conversationHistory = [];
  currentChatId = null;
  updateQuotePreview('');
  clearImagePreviews();  // ← 新增
  chatArea.innerHTML = '<div class="welcome-msg"><p>打开任意网页，点击上方按钮或输入问题开始使用。</p></div>';
});
```

- [ ] **Step 3: Reload extension and test the full flow**

1. Upload an image → thumbnail appears with loading/error state
2. Type text, press Enter → message sends, preview bar clears
3. Upload image, then click "新建聊天" → preview bar clears

- [ ] **Step 4: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat(ocr): integrate OCR guards into send flow and new chat"
```

---

### Task 6: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add OCR state to state management section**

In the "State management in side_panel.js" section, add the new state variables:

```markdown
- `ocrResults` — array of `{ index, fileName, text }` for OCR-recognized image content (in-memory, cleared on send/new chat)
- `ocrRunning` — counter for in-progress OCR API calls
- `imageIndex` — auto-incrementing index for image numbering
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document OCR state variables in CLAUDE.md"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Upload button ✓, thumbnail preview ✓, OCR calling ✓, status display ✓, remove image ✓, send guard ✓, new chat clear ✓, ocrContext format ✓
- [ ] **Placeholder scan:** No TBD/TODO found
- [ ] **Type consistency:** `ocrResults` always `[{index, fileName, text}]`, `ocrRunning` always number, DOM references consistent across all tasks
- [ ] **Service worker action:** Matches existing `msg.action === 'ocrParse'` in service_worker.js ✓
