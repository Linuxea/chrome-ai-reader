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
  if (!ttsPlaying) return;

  // 此时 ttsAppendChunk 已经积累了文本（来自 callAI 的 chunk 回调）
  // initTTSPlayback 已在 callAI 开头调用，这里只 flush 剩余
  ttsFlushRemaining();
}
