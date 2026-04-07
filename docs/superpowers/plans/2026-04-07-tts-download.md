# TTS Download Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a download button to the side panel that silently generates a complete MP3 from the latest AI message and triggers a browser download.

**Architecture:** A new `'tts-download'` port in the service worker reuses the existing `callTTS()` function. The side panel collects all audio chunks from sequential segment requests into memory, then assembles them into a single MP3 Blob and triggers a download via a hidden `<a>` tag.

**Tech Stack:** Chrome Extension APIs (ports, storage), Web Audio / Blob / ObjectURL for download, existing Volcengine TTS API.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/i18n.js` | Modify | Add `action.ttsDownload` and `status.ttsDownloading` keys |
| `src/background/service-worker.js` | Modify | Add `'tts-download'` port handler |
| `src/side_panel/side_panel.css` | Modify | Add `.tts-download-btn` styles |
| `src/side_panel/services/tts.js` | Modify | Add download button, download handler, download state |

---

### Task 1: Add i18n translation keys

**Files:**
- Modify: `src/shared/i18n.js:91` (zh section, after `'action.tts'`)
- Modify: `src/shared/i18n.js:255` (en section, after `'action.tts'`)
- Modify: `src/shared/i18n.js:133` (zh section, after `'status.parseError'`)
- Modify: `src/shared/i18n.js:297` (en section, after `'status.parseError'`)

- [ ] **Step 1: Add zh keys**

In `src/shared/i18n.js`, in the `zh` object, after line 91 (`'action.tts': '朗读',`), add:

```js
    'action.ttsDownload': '下载语音',
```

After line 133 (`'status.parseError': '解析文件失败：',`), add:

```js
    'status.ttsDownloading': '正在生成语音...',
```

- [ ] **Step 2: Add en keys**

In the `en` object, after line 255 (`'action.tts': 'Read Aloud',`), add:

```js
    'action.ttsDownload': 'Download Audio',
```

After line 297 (`'status.parseError': 'Failed to parse file: ',`), add:

```js
    'status.ttsDownloading': 'Generating audio...',
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/i18n.js
git commit -m "feat: add i18n keys for TTS download button"
```

---

### Task 2: Add service worker port handler for tts-download

**Files:**
- Modify: `src/background/service-worker.js:275` (after `'tts'` port handler, before `'suggest-questions'`)

- [ ] **Step 1: Add the port handler**

In `src/background/service-worker.js`, after line 274 (the closing `});` of the `tts` port handler block), insert before the `} else if (port.name === 'suggest-questions')` block:

```js
  } else if (port.name === 'tts-download') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'tts') {
        await callTTS(msg.text, port);
      }
    });
```

The full `onConnect` listener should now read:

```js
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ai-chat') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'chat') {
        await callOpenAI(msg.messages, port, { response_format: msg.response_format });
      }
    });
  } else if (port.name === 'tts') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'tts') {
        await callTTS(msg.text, port);
      }
    });
  } else if (port.name === 'tts-download') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'tts') {
        await callTTS(msg.text, port);
      }
    });
  } else if (port.name === 'suggest-questions') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'suggest') {
        await callSuggestQuestions(msg.messages, port);
      }
    });
  }
});
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.js
git commit -m "feat: add tts-download port handler in service worker"
```

---

### Task 3: Add CSS styles for download button

**Files:**
- Modify: `src/side_panel/side_panel.css:821-877` (TTS & AI Action Buttons section)

- [ ] **Step 1: Add .tts-download-btn to shared selectors**

In `src/side_panel/side_panel.css`, update the existing selectors to include `.tts-download-btn`:

Change line 821-822 from:
```css
.tts-btn,
.ai-action-btn {
```
to:
```css
.tts-btn,
.tts-download-btn,
.ai-action-btn {
```

Change line 839-840 from:
```css
.tts-btn:hover,
.ai-action-btn:hover {
```
to:
```css
.tts-btn:hover,
.tts-download-btn:hover,
.ai-action-btn:hover {
```

Change line 845-846 from:
```css
.tts-btn svg,
.ai-action-btn svg {
```
to:
```css
.tts-btn svg,
.tts-download-btn svg,
.ai-action-btn svg {
```

- [ ] **Step 2: Add download-specific styles**

After line 877 (after the `@keyframes tts-wave` block), add:

```css

.tts-download-btn.tts-loading {
  opacity: 1;
  color: var(--primary);
  cursor: wait;
}

.tts-download-btn.tts-loading svg {
  animation: tts-pulse 1.2s ease-in-out infinite;
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/side_panel.css
git commit -m "feat: add CSS styles for TTS download button"
```

---

### Task 4: Add download button and download handler to tts.js

**Files:**
- Modify: `src/side_panel/services/tts.js` (add state variables, download handler, update addTTSButton)

- [ ] **Step 1: Add download state variables**

In `src/side_panel/services/tts.js`, after line 24 (`let ttsAutoPlayEnabled = false;`), add:

```js
// TTS 下载状态
let ttsDownloadPort = null;
let ttsDownloadChunks = [];
let ttsDownloadSegments = [];
let ttsDownloadSegmentIndex = 0;
let ttsDownloadSending = false;
let ttsDownloading = false;
```

- [ ] **Step 2: Add the download handler function**

After the `stopTTS()` function (after line 126), add:

```js
/**
 * 停止 TTS 下载
 */
function stopTTSDownload() {
  ttsDownloading = false;
  ttsDownloadChunks = [];
  ttsDownloadSegments = [];
  ttsDownloadSegmentIndex = 0;
  ttsDownloadSending = false;

  if (ttsDownloadPort) {
    try { ttsDownloadPort.disconnect(); } catch {}
    ttsDownloadPort = null;
  }

  const btn = _chatArea.querySelector('.tts-download-btn');
  if (btn) {
    btn.classList.remove('tts-loading');
    btn.disabled = false;
  }
}
```

- [ ] **Step 3: Add the segment-sending and chunk-collection logic**

After `stopTTSDownload`, add:

```js
function ttsDownloadFlush() {
  if (ttsDownloadSending || ttsDownloadSegmentIndex >= ttsDownloadSegments.length || !ttsDownloading) return;

  ttsDownloadSending = true;
  const segment = ttsDownloadSegments[ttsDownloadSegmentIndex];
  ttsDownloadSegmentIndex++;

  ttsDownloadPort = chrome.runtime.connect({ name: 'tts-download' });

  ttsDownloadPort.onDisconnect.addListener(() => {
    if (ttsDownloading) stopTTSDownload();
  });

  ttsDownloadPort.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      if (!msg.data) return;
      ttsDownloadChunks.push(msg.data);
    } else if (msg.type === 'done') {
      ttsDownloadSending = false;
      try { ttsDownloadPort.disconnect(); } catch {}
      ttsDownloadPort = null;

      if (ttsDownloadSegmentIndex < ttsDownloadSegments.length) {
        ttsDownloadFlush();
      } else {
        finishTTSDownload();
      }
    } else if (msg.type === 'error') {
      console.error('[TTS Download] error:', msg.error || msg.errorKey);
      stopTTSDownload();
    }
  });

  ttsDownloadPort.postMessage({ type: 'tts', text: segment });
}

function finishTTSDownload() {
  if (ttsDownloadChunks.length === 0) {
    stopTTSDownload();
    return;
  }

  // Decode all base64 chunks into a single Uint8Array
  const totalLength = ttsDownloadChunks.reduce((sum, chunk) => {
    const binary = atob(chunk);
    return sum + binary.length;
  }, 0);

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of ttsDownloadChunks) {
    const binary = atob(chunk);
    for (let i = 0; i < binary.length; i++) {
      result[offset++] = binary.charCodeAt(i);
    }
  }

  // Create blob and trigger download
  const blob = new Blob([result], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `voice-${timestamp}.mp3`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Show success state briefly
  const btn = _chatArea.querySelector('.tts-download-btn');
  if (btn) {
    btn.classList.remove('tts-loading');
    btn.disabled = false;
    // Brief checkmark feedback
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    btn.title = t('action.copied'); // reuse "Done" concept
    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.title = t('action.ttsDownload');
    }, 1500);
  }

  // Reset state
  ttsDownloading = false;
  ttsDownloadChunks = [];
  ttsDownloadSegments = [];
  ttsDownloadSegmentIndex = 0;
}
```

- [ ] **Step 4: Add handleTTSDownloadClick function**

After `finishTTSDownload`, add:

```js
/**
 * TTS 下载按钮点击处理
 */
function handleTTSDownloadClick(msgEl) {
  if (ttsDownloading) return; // double-click protection

  const contentEl = msgEl.querySelector('.thinking-response-content');
  const text = contentEl ? contentEl.textContent : msgEl.textContent;
  if (!text || !text.trim()) return;

  // Set loading state
  const btn = _chatArea.querySelector('.tts-download-btn');
  if (btn) {
    btn.classList.add('tts-loading');
    btn.disabled = true;
    btn.title = t('status.ttsDownloading');
  }

  ttsDownloading = true;
  ttsDownloadChunks = [];
  ttsDownloadSegmentIndex = 0;
  ttsDownloadSending = false;
  ttsDownloadSegments = splitToSegments(text.trim());

  if (ttsDownloadSegments.length === 0) {
    stopTTSDownload();
    return;
  }

  ttsDownloadFlush();
}
```

- [ ] **Step 5: Update addTTSButton to create the download button and clean up old ones**

In the `addTTSButton` function, update the cleanup section (lines 350-354). Change:

```js
  const prevTts = _chatArea.querySelector('.tts-btn');
  if (prevTts) prevTts.remove();
  const prevCopy = _chatArea.querySelector('.ai-action-btn');
  if (prevCopy) prevCopy.remove();
```

to:

```js
  const prevTts = _chatArea.querySelector('.tts-btn');
  if (prevTts) prevTts.remove();
  const prevDownload = _chatArea.querySelector('.tts-download-btn');
  if (prevDownload) prevDownload.remove();
  const prevCopy = _chatArea.querySelector('.ai-action-btn');
  if (prevCopy) prevCopy.remove();
```

Then, after line 383 (`msgEl.appendChild(btn);`), add the download button creation:

```js

  // TTS Download button
  const dlBtn = document.createElement('button');
  dlBtn.className = 'tts-download-btn';
  dlBtn.title = t('action.ttsDownload');
  dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

  dlBtn.addEventListener('click', () => handleTTSDownloadClick(msgEl));

  msgEl.appendChild(dlBtn);
```

- [ ] **Step 6: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/side_panel/services/tts.js
git commit -m "feat: add TTS download button and handler"
```

---

### Task 5: Update stopTTS to also stop downloads

**Files:**
- Modify: `src/side_panel/services/tts.js:96` (stopTTS function)

- [ ] **Step 1: Add stopTTSDownload call to stopTTS**

In the `stopTTS()` function, add a call to `stopTTSDownload()` at the beginning. Change the start of `stopTTS()` (line 96) from:

```js
export function stopTTS() {
  ttsPlaying = false;
```

to:

```js
export function stopTTS() {
  stopTTSDownload();
  ttsPlaying = false;
```

This ensures that when TTS playback is stopped (e.g., user sends a new message or starts a new chat), any in-progress download is also cancelled.

- [ ] **Step 2: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/services/tts.js
git commit -m "fix: stop TTS download when playback stops or new message is sent"
```

---

### Task 6: Manual smoke test

- [ ] **Step 1: Build and load the extension**

```bash
npm run build
```

Then open `chrome://extensions/` → enable Developer mode → "Load unpacked" → select the `dist/` directory.

- [ ] **Step 2: Verify button appears**

Open any webpage, open the side panel, send a message to get an AI response. Verify:
- A download icon button appears next to the TTS play button on the AI message
- Hovering shows the "Download Audio" / "下载语音" tooltip

- [ ] **Step 3: Verify download flow**

Click the download button. Verify:
- Button shows loading animation
- After a few seconds, a `voice-<timestamp>.mp3` file downloads
- Button returns to normal state
- The downloaded MP3 plays correctly

- [ ] **Step 4: Verify concurrency**

While TTS is playing (click the play button), click the download button. Verify:
- Both operations work independently
- No interference between playback and download

- [ ] **Step 5: Verify error handling**

With TTS not configured (remove TTS App ID from settings), click download. Verify:
- Button returns to normal state (no infinite loading)

- [ ] **Step 6: Verify cleanup**

Send a new AI message. Verify:
- Old download button is removed
- New download button appears on the new message
