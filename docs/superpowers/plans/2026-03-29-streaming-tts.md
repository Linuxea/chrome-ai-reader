# 流式 TTS 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AI 流式生成过程中逐句发送 TTS，降低用户听到语音的等待时间。

**Architecture:** 在 side_panel 目录下新建 `tts-streaming.js`，将所有 TTS 相关代码从 `side_panel.js` 迁移过来并改为句子队列 + 顺序调度器模式。service_worker.js 不改动。

**Tech Stack:** Vanilla JS（Chrome Extension Manifest V3，无构建系统）

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `side_panel/tts-streaming.js` | Create | 所有 TTS 逻辑：状态管理、句子切分、队列调度、MediaSource 播放、UI 按钮 |
| `side_panel/side_panel.js` | Modify | 移除迁移的 TTS 代码，在 callAI() 中调用 tts-streaming 接口 |
| `side_panel/side_panel.html` | Modify | 添加 `<script src="tts-streaming.js">` 加载 |

---

### Task 1: 创建 tts-streaming.js 基础框架

**Files:**
- Create: `side_panel/tts-streaming.js`

- [ ] **Step 1: 创建文件，写入状态变量和工具函数**

```js
// tts-streaming.js — 流式 TTS 语音合成

// TTS 播放状态
let ttsPort = null;
let ttsPlaying = false;
let ttsDone = false;
let ttsMediaSource = null;
let ttsSourceBuffer = null;
let ttsAudioEl = null;
let ttsChunkQueue = [];
let ttsBufferAppending = false;

// 流式 TTS 状态
let ttsSentenceQueue = [];
let ttsTextBuffer = '';
let ttsSending = false;
let ttsSentenceCount = 0;

// TTS 自动播放状态
let ttsAutoPlayEnabled = false;

// 加载 TTS 自动播放开关
chrome.storage.sync.get(['ttsAutoPlay'], (data) => {
  ttsAutoPlayEnabled = data.ttsAutoPlay === true;
});

// 监听自动播放开关变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.ttsAutoPlay) {
    ttsAutoPlayEnabled = changes.ttsAutoPlay.newValue === true;
  }
});
```

- [ ] **Step 2: 添加 stripMarkdown 函数**

```js
/**
 * 简单清理 Markdown 语法，返回纯文本供 TTS 使用
 */
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')           // 代码块
    .replace(/`([^`]+)`/g, '$1')               // 行内代码
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // 链接 → 保留文本
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')  // 图片 → 保留 alt
    .replace(/#{1,6}\s+/g, '')                  // 标题
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // 粗体
    .replace(/\*([^*]+)\*/g, '$1')              // 斜体
    .replace(/__([^_]+)__/g, '$1')              // 粗体下划线
    .replace(/_([^_]+)_/g, '$1')               // 斜体下划线
    .replace(/~~([^~]+)~~/g, '$1')              // 删除线
    .replace(/^[-*+]\s+/gm, '')                 // 无序列表标记
    .replace(/^\d+\.\s+/gm, '')                 // 有序列表标记
    .replace(/^>\s+/gm, '')                     // 引用标记
    .trim();
}
```

- [ ] **Step 3: 添加 splitToSegments 函数**

```js
const SENTENCE_ENDS = '。！？.!?';

/**
 * 将完整文本按句末标点切分为段（每 5 个句末标点一段）
 */
function splitToSegments(text) {
  const segments = [];
  let count = 0;
  let lastCut = 0;

  for (let i = 0; i < text.length; i++) {
    if (SENTENCE_ENDS.includes(text[i])) {
      count++;
      if (count >= 5) {
        segments.push(text.slice(lastCut, i + 1).trim());
        lastCut = i + 1;
        count = 0;
      }
    }
  }

  // 剩余文本
  const remaining = text.slice(lastCut).trim();
  if (remaining) {
    segments.push(remaining);
  }

  return segments.filter(s => s.length > 0);
}
```

- [ ] **Step 4: 添加 stopTTS 函数**

```js
function stopTTS() {
  ttsPlaying = false;
  ttsDone = true;
  ttsSentenceQueue = [];
  ttsTextBuffer = '';
  ttsSentenceCount = 0;
  ttsSending = false;
  ttsChunkQueue = [];
  ttsBufferAppending = false;

  if (ttsAudioEl) {
    ttsAudioEl.pause();
    ttsAudioEl.src = '';
    ttsAudioEl = null;
  }
  if (ttsMediaSource) {
    try { if (ttsMediaSource.readyState === 'open') ttsMediaSource.endOfStream(); } catch {}
    ttsMediaSource = null;
    ttsSourceBuffer = null;
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
```

- [ ] **Step 5: 添加 ttsAppendNext 函数**

```js
function ttsAppendNext() {
  if (!ttsSourceBuffer || ttsBufferAppending || ttsChunkQueue.length === 0) return;
  ttsBufferAppending = true;
  const chunk = ttsChunkQueue.shift();
  try {
    ttsSourceBuffer.appendBuffer(chunk);
  } catch (e) {
    console.error('[TTS] appendBuffer error:', e);
    ttsBufferAppending = false;
  }
}
```

- [ ] **Step 6: 添加 initTTSPlayback 函数**

```js
function initTTSPlayback() {
  ttsPlaying = true;
  ttsDone = false;
  ttsSentenceQueue = [];
  ttsTextBuffer = '';
  ttsSentenceCount = 0;
  ttsSending = false;
  ttsChunkQueue = [];
  ttsBufferAppending = false;

  const btn = chatArea.querySelector('.tts-btn');
  if (btn) btn.classList.add('tts-loading');

  // 用 MSE 实现流式播放
  ttsMediaSource = new MediaSource();
  ttsAudioEl = new Audio();
  ttsAudioEl.src = URL.createObjectURL(ttsMediaSource);

  let started = false;

  ttsMediaSource.addEventListener('sourceopen', () => {
    ttsSourceBuffer = ttsMediaSource.addSourceBuffer('audio/mpeg');
    ttsSourceBuffer.addEventListener('updateend', () => {
      ttsBufferAppending = false;
      // 首次有数据后自动播放
      if (!started && ttsAudioEl && ttsSourceBuffer.buffered.length > 0) {
        started = true;
        ttsAudioEl.play().then(() => {
          if (btn) {
            btn.classList.remove('tts-loading');
            btn.classList.add('tts-playing');
          }
        }).catch(() => {});
      }
      ttsAppendNext();
    });

    // 开始调度
    ttsFlush();
  });

  ttsAudioEl.addEventListener('ended', () => {
    stopTTS();
  });
}
```

- [ ] **Step 7: 添加 ttsEnqueue 和 ttsFlush 调度器**

```js
function ttsEnqueue(text) {
  const cleaned = stripMarkdown(text);
  if (!cleaned) return;
  ttsSentenceQueue.push(cleaned);
  ttsFlush();
}

function ttsFlush() {
  if (ttsSending || ttsSentenceQueue.length === 0 || !ttsPlaying) return;
  if (!ttsSourceBuffer) return; // MediaSource 未就绪

  ttsSending = true;
  const sentence = ttsSentenceQueue.shift();

  // 创建新的 TTS port
  ttsPort = chrome.runtime.connect({ name: 'tts' });

  ttsPort.onDisconnect.addListener(() => {
    if (ttsPlaying) stopTTS();
  });

  ttsPort.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      if (!msg.data) return;
      const binaryStr = atob(msg.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      ttsChunkQueue.push(bytes.buffer);
      ttsAppendNext();

    } else if (msg.type === 'done') {
      ttsSending = false;
      // 关闭当前 port
      try { ttsPort.disconnect(); } catch {}
      ttsPort = null;

      if (ttsSentenceQueue.length > 0) {
        // 还有待发送的句子，继续调度
        ttsFlush();
      } else {
        // 所有句子已发完
        ttsDone = true;
        const finish = () => {
          if (ttsSourceBuffer && !ttsBufferAppending) {
            try { ttsMediaSource.endOfStream(); } catch {}
          }
        };
        if (ttsBufferAppending) {
          const handler = () => { finish(); ttsSourceBuffer.removeEventListener('updateend', handler); };
          ttsSourceBuffer.addEventListener('updateend', handler);
        } else {
          finish();
        }
      }

    } else if (msg.type === 'error') {
      console.error('[TTS] error:', msg.error);
      stopTTS();
    }
  });

  ttsPort.postMessage({ type: 'tts', text: sentence });
}
```

- [ ] **Step 8: 添加 ttsAppendChunk 和 ttsFlushRemaining（供 side_panel.js 调用）**

```js
/**
 * AI chunk 到来时调用，追加缓冲区 + 计数 + 入队
 */
function ttsAppendChunk(content) {
  if (!ttsPlaying || !ttsAutoPlayEnabled) return;

  ttsTextBuffer += content;

  // 计算新增的句末标点数
  for (let i = 0; i < content.length; i++) {
    if (SENTENCE_ENDS.includes(content[i])) {
      ttsSentenceCount++;
    }
  }

  // 循环切分：每 5 个句末标点切一次
  while (ttsSentenceCount >= 5) {
    let found = 0;
    let cutPos = -1;
    for (let i = 0; i < ttsTextBuffer.length; i++) {
      if (SENTENCE_ENDS.includes(ttsTextBuffer[i])) {
        found++;
        if (found >= 5) {
          cutPos = i + 1;
          break;
        }
      }
    }

    if (cutPos === -1) break;

    const segment = ttsTextBuffer.slice(0, cutPos);
    ttsTextBuffer = ttsTextBuffer.slice(cutPos);
    ttsSentenceCount -= 5;
    ttsEnqueue(segment);
  }
}

/**
 * AI done 时调用，把缓冲区剩余文本入队
 */
function ttsFlushRemaining() {
  if (!ttsPlaying) return;

  if (ttsTextBuffer.trim()) {
    ttsEnqueue(ttsTextBuffer.trim());
    ttsTextBuffer = '';
    ttsSentenceCount = 0;
  }

  // 如果队列已空且无请求在飞，直接结束
  if (ttsSentenceQueue.length === 0 && !ttsSending) {
    const finish = () => {
      if (ttsSourceBuffer && !ttsBufferAppending) {
        try { ttsMediaSource.endOfStream(); } catch {}
      }
    };
    if (ttsBufferAppending) {
      const handler = () => { finish(); ttsSourceBuffer.removeEventListener('updateend', handler); };
      ttsSourceBuffer.addEventListener('updateend', handler);
    } else {
      finish();
    }
  }
}
```

- [ ] **Step 9: 添加 handleTTSButtonClick、addTTSButton、initTTSAutoPlay**

```js
/**
 * TTS 按钮点击处理（toggle 行为）
 */
function handleTTSButtonClick(msgEl) {
  if (ttsPlaying) {
    stopTTS();
    return;
  }

  const contentEl = msgEl.querySelector('.thinking-response-content');
  const text = contentEl ? contentEl.textContent : msgEl.textContent;
  if (!text || !text.trim()) return;

  initTTSPlayback();
  const segments = splitToSegments(text.trim());
  segments.forEach(seg => ttsEnqueue(seg));
}

/**
 * 在 AI 消息上添加 TTS + 复制按钮
 */
function addTTSButton(msgEl) {
  // 移除之前的 TTS 按钮和复制按钮
  const prevTts = chatArea.querySelector('.tts-btn');
  if (prevTts) prevTts.remove();
  const prevCopy = chatArea.querySelector('.ai-action-btn');
  if (prevCopy) prevCopy.remove();

  // 复制按钮
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ai-action-btn';
  copyBtn.title = '复制';
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  copyBtn.addEventListener('click', () => {
    const contentEl = msgEl.querySelector('.thinking-response-content');
    const text = contentEl ? contentEl.textContent : msgEl.textContent;
    if (text && text.trim()) {
      navigator.clipboard.writeText(text.trim()).then(() => {
        copyBtn.title = '已复制';
        setTimeout(() => { copyBtn.title = '复制'; }, 1500);
      });
    }
  });

  msgEl.appendChild(copyBtn);

  // TTS 按钮
  const btn = document.createElement('button');
  btn.className = 'tts-btn';
  btn.title = '朗读';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

  btn.addEventListener('click', () => handleTTSButtonClick(msgEl));

  msgEl.appendChild(btn);
}

/**
 * AI done 且 ttsAutoPlayEnabled 时调用，启动流式自动播放
 */
function initTTSAutoPlay(msgEl) {
  if (!ttsAutoPlayEnabled) return;

  const contentEl = msgEl.querySelector('.thinking-response-content');
  const text = contentEl ? contentEl.textContent : msgEl.textContent;
  if (!text || !text.trim()) return;

  initTTSPlayback();
  // 此时 ttsAppendChunk 已经积累了文本（来自 callAI 的 chunk 回调）
  // 这里 flush 剩余即可
  ttsFlushRemaining();
}
```

- [ ] **Step 10: Commit**

```bash
git add side_panel/tts-streaming.js
git commit -m "feat: add tts-streaming.js with streaming TTS logic"
```

---

### Task 2: 修改 side_panel.js — 移除迁移代码并接入流式 TTS

**Files:**
- Modify: `side_panel/side_panel.js`

- [ ] **Step 1: 删除已迁移到 tts-streaming.js 的状态变量**

删除以下行（约 39-53 行）：
```js
// TTS 播放状态
let ttsPort = null;
let ttsPlaying = false;
let ttsDone = false;
let ttsMediaSource = null;
let ttsSourceBuffer = null;
let ttsAudioEl = null;
let ttsChunkQueue = [];
let ttsBufferAppending = false;
...
// TTS 自动播放状态
let ttsAutoPlayEnabled = false;
```

- [ ] **Step 2: 删除已迁移的 chrome.storage 加载**

删除以下行（约 107-110 行）：
```js
// 加载 TTS 自动播放开关
chrome.storage.sync.get(['ttsAutoPlay'], (data) => {
  ttsAutoPlayEnabled = data.ttsAutoPlay === true;
});
```

- [ ] **Step 3: 删除 chrome.storage.onChanged 中的 ttsAutoPlay 监听**

在 `chrome.storage.onChanged` 回调中删除以下代码块（约 822-824 行）：
```js
if (changes.ttsAutoPlay) {
  ttsAutoPlayEnabled = changes.ttsAutoPlay.newValue === true;
}
```

- [ ] **Step 4: 删除已迁移的函数**

删除以下函数（约 510-682 行）：
- `stopTTS()` 函数
- `ttsAppendNext()` 函数
- `playTTS()` 函数
- `addTTSButton()` 函数

- [ ] **Step 5: 修改 callAI() — 在 chunk 回调中调用 ttsAppendChunk**

在 `msg.type === 'chunk'` 的处理块中，`contentEl.innerHTML = marked.parse(fullText);` 之后添加：

```js
// 流式 TTS：追加文本缓冲
if (ttsAutoPlayEnabled) {
  ttsAppendChunk(msg.content);
}
```

注意：需要在此块开头初始化 TTS。在 `isGenerating = true;` 之后、`port.postMessage` 之前，添加：

```js
// 如果自动播放开启，初始化 TTS 播放
if (ttsAutoPlayEnabled) {
  initTTSPlayback();
}
```

- [ ] **Step 6: 修改 callAI() — 在 done 回调中替换 TTS 逻辑**

将 done 回调中的 TTS 自动播放逻辑：

```js
// 添加 TTS 按钮
addTTSButton(msgEl);
// TTS 自动播放
if (ttsAutoPlayEnabled && fullText.trim()) {
  const contentEl = msgEl.querySelector('.thinking-response-content');
  const ttsText = contentEl ? contentEl.textContent : msgEl.textContent;
  if (ttsText && ttsText.trim()) {
    playTTS(ttsText.trim());
  }
}
```

替换为：

```js
// 添加 TTS 按钮
addTTSButton(msgEl);
// 流式 TTS：flush 剩余文本
initTTSAutoPlay(msgEl);
```

- [ ] **Step 7: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "refactor: remove migrated TTS code from side_panel.js and integrate streaming TTS"
```

---

### Task 3: 修改 side_panel.html — 加载新脚本

**Files:**
- Modify: `side_panel/side_panel.html`

- [ ] **Step 1: 在 side_panel.js 之前添加 tts-streaming.js**

在 `<script src="ui-helpers.js"></script>` 和 `<script src="side_panel.js"></script>` 之间插入：

```html
<script src="tts-streaming.js"></script>
```

最终加载顺序：
```html
<script src="../libs/marked.min.js"></script>
<script src="chat-history.js"></script>
<script src="quick-commands.js"></script>
<script src="ui-helpers.js"></script>
<script src="tts-streaming.js"></script>
<script src="side_panel.js"></script>
```

- [ ] **Step 2: Commit**

```bash
git add side_panel/side_panel.html
git commit -m "feat: load tts-streaming.js in side panel"
```

---

### Task 4: 手动测试验证

此项目无自动化测试框架，需在 Chrome 中手动验证。

- [ ] **Step 1: 加载扩展**

1. 打开 `chrome://extensions/`
2. 启用开发者模式
3. 点击"加载已解压的扩展程序" → 选择项目目录（或刷新已有加载）

- [ ] **Step 2: 测试自动流式 TTS**

1. 打开任意网页 → 点击扩展图标打开侧边栏
2. 设置中配置好 API Key 和 TTS 配置
3. 开启 TTS 自动播放开关
4. 点击"总结"或输入问题
5. **验证：** AI 开始回复后，应该在几秒内听到语音（不需要等 AI 完整回复）
6. **验证：** 语音应持续播放，覆盖 AI 的完整回复

- [ ] **Step 3: 测试手动点击 TTS**

1. 关闭自动播放开关
2. 让 AI 生成一条回复
3. 点击朗读按钮
4. **验证：** 立即开始播放
5. **验证：** 播放过程中再次点击 → 停止播放（toggle 行为）

- [ ] **Step 4: 测试新消息中断 TTS**

1. 播放 TTS 过程中发送新消息
2. **验证：** TTS 停止播放

- [ ] **Step 5: 测试新建聊天中断 TTS**

1. 播放 TTS 过程中点击"新建聊天"
2. **验证：** TTS 停止播放
