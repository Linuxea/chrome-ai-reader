// features/podcast.js — Podcast generation and streaming playback

import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
import { appendMessage, scrollToBottom } from '../ui/dom-helpers.js';
import { extractPageContent } from '../services/ai-chat.js';
import { isTTSPlaying, stopTTS } from '../services/tts.js';
import { clearImagePreviews } from '../services/ocr.js';

// --- Constants ---

const PODCAST_PROMPT = `你是一位经验丰富的播客制作人，擅长将复杂内容转化为引人入胜的双人对谈。

## 角色

**主播A（主持人）**
- 引导话题走向，把控节奏，适时追问和总结
- 用通俗易懂的方式拆解概念，帮助听众理解
- 语气：好奇、热情、善于倾听

**主播B（嘉宾）**
- 提供专业深度分析和独特视角
- 敢于表达鲜明立场，不回避争议
- 善用类比和案例让抽象观点具象化
- 语气：自信、有洞察力、偶有幽默

## 节目结构（共 20-25 轮，交替发言）

1. **开场引入**（2-3 轮）：用悬念或反直觉的观点切入，激发兴趣，快速交代背景
2. **层层递进**（15-20 轮）：
   - 按"现象 → 原因 → 本质 → 延伸"的逻辑链逐步推进，不要在同一层面原地打转
   - 每一轮都要比上一轮更深入或转换新角度，让听众感觉"越聊越有料"
   - 两人在不同阶段承担不同角色：梳理事实、挖掘原因、提出质疑、引入新视角
   - 穿插具体数据、案例或类比来支撑观点
   - 模拟真实对话节奏：追问、补充、反驳、认可交替出现
3. **收尾升华**（2-3 轮）：提炼核心洞察，给出启发性思考或实用建议

## 写作规范

1. **忠实原文**：所有事实、数据、引述必须源自原文，严禁编造
2. **口语化表达**：
   - 使用短句和口语衔接词（"对"、"没错"、"但你有没有想过"、"举个例子来说"）
   - 避免书面语长句、排比句、公文腔
   - 允许适度的语气词和口语停顿
3. **篇幅控制**：每轮 50-280 字
4. **交替发言**：A 和 B 严格交替，不得连续两轮同一人
5. **信息密度**：每轮至少包含一个有价值的信息点，避免空泛的过渡语

## 输出格式

严格输出以下 JSON，不要输出任何其他内容（不要 markdown 代码块）：
{"rounds":[{"speaker":"A","text":"对话内容"},{"speaker":"B","text":"对话内容"}]}

待处理的内容：`;

// Speaker mapping: script labels → Volcengine podcast speaker IDs
// These are saturn-series speakers specifically for the podcast API (volc.service_type.10050)
const SPEAKER_MAP = {
  'A': 'zh_male_dayixiansheng_v2_saturn_bigtts',
  'B': 'zh_female_mizaitongxue_v2_saturn_bigtts',
};
const DEFAULT_SPEAKER = 'zh_female_mizaitongxue_v2_saturn_bigtts';

// --- Module state ---

let _chatArea;
let _podcastBtn;
let _currentCard = null;

// Audio playback state
let podcastPort = null;
let podcastAudioEl = null;
let podcastMediaSource = null;
let podcastSourceBuffer = null;
let podcastChunkQueue = [];
let podcastBufferAppending = false;
let podcastPlayTransitioning = false; // Debounce for play/pause
const MAX_CHUNK_QUEUE_SIZE = 50; // Prevent memory issues with long podcasts
let podcastAudioChunks = []; // Collected chunks for download

// LLM script generation state
let podcastLlmPort = null;
let podcastCancelled = false;

// --- Init ---

export function initPodcast({ chatArea }) {
  _chatArea = chatArea;
  _podcastBtn = document.querySelector('[data-action="podcast"]');
  state.subscribe('isGenerating', (v) => {
    if (_podcastBtn && !state.getIsPodcastGenerating()) {
      _podcastBtn.disabled = v;
    }
  });
}

export async function handlePodcastClick() {
  if (state.getIsGenerating() || state.getIsPodcastGenerating()) return;

  // Lock immediately to prevent double-click race condition
  state.setIsPodcastGenerating(true);
  if (_podcastBtn) _podcastBtn.disabled = true;

  // Reset cancellation flag for new invocation
  podcastCancelled = false;

  // Stop any currently playing TTS and clean up previous podcast audio
  if (isTTSPlaying()) stopTTS();
  cleanupPodcast();
  // Re-acquire lock (cleanupPodcast resets isPodcastGenerating)
  state.setIsPodcastGenerating(true);
  if (_podcastBtn) _podcastBtn.disabled = true;

  // Extract text source (same priority as quick actions)
  const selectedText = state.getSelectedText();
  const hasSelection = selectedText && selectedText.trim().length > 0;

  // Clear quote preview and image previews (same as other quick actions)
  const quotePreview = document.getElementById('quotePreview');
  if (quotePreview) quotePreview.classList.add('hidden');
  state.setSelectedText('');
  clearImagePreviews();

  let textContent;
  if (hasSelection) {
    textContent = selectedText.trim();
  } else {
    try {
      const data = await extractPageContent();
      textContent = data.textContent;
    } catch {
      textContent = state.getPageContent();
    }
  }

  // Append OCR results if present
  const ocrResults = state.getOcrResults();
  if (ocrResults && ocrResults.length > 0) {
    const ocrText = ocrResults.map(r => r.text).filter(Boolean).join('\n\n');
    if (ocrText) {
      textContent = textContent ? textContent + '\n\n' + ocrText : ocrText;
    }
  }

  if (!textContent || !textContent.trim()) {
    appendMessage('error', t('podcast.noContent'));
    resetPodcastState();
    return;
  }

  // Create podcast card
  const sourcePreview = hasSelection
    ? selectedText.trim().slice(0, 100) + (selectedText.trim().length > 100 ? '...' : '')
    : '';
  const card = createPodcastCard(sourcePreview);
  _currentCard = card;

  // Start LLM script generation
  await generatePodcastScript(card, textContent);
}

// --- Podcast card UI ---

function createPodcastCard(quotePreview) {
  // Remove existing podcast card if any
  const existing = _chatArea.querySelector('.podcast-card');
  if (existing) existing.remove();

  // Remove welcome message if present
  const welcome = _chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const card = document.createElement('div');
  card.className = 'podcast-card';

  const quoteHtml = quotePreview
    ? `<blockquote class="podcast-quote">${escapeHtml(quotePreview)}</blockquote>`
    : '';

  card.innerHTML = `
    <div class="podcast-card-header">
      <span class="podcast-card-title">🎙️ ${t('podcast.cardTitle')}</span>
      <button class="podcast-card-close" title="${t('chart.close')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    ${quoteHtml}
    <div class="podcast-status" data-status="generating_script">
      <div class="podcast-status-spinner"></div>
      <span>${t('podcast.generatingScript')}</span>
    </div>
    <div class="podcast-player">
      <div class="podcast-player-row">
        <button class="podcast-play-btn" title="${t('podcast.play')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </button>
        <div class="podcast-progress-bar">
          <div class="podcast-progress-fill"></div>
        </div>
        <span class="podcast-time">0:00 / 0:00</span>
      </div>
    </div>
  `;

  // Close button handler
  card.querySelector('.podcast-card-close').addEventListener('click', () => {
    podcastCancelled = true;
    cleanupPodcast();
    card.remove();
    _currentCard = null;
    restoreWelcomeIfNeeded();
  });

  // Play/pause button handler
  card.querySelector('.podcast-play-btn').addEventListener('click', handlePlayPause);

  _chatArea.appendChild(card);
  scrollToBottom();

  return card;
}

function updateCardStatus(card, status, text) {
  const statusEl = card.querySelector('.podcast-status');
  const playerEl = card.querySelector('.podcast-player');

  switch (status) {
    case 'generating_script':
      statusEl.innerHTML = `<div class="podcast-status-spinner"></div><span>${t('podcast.generatingScript')}</span>`;
      statusEl.className = 'podcast-status';
      statusEl.style.display = '';
      playerEl.classList.remove('active');
      break;
    case 'generating_audio':
      statusEl.innerHTML = `<div class="podcast-status-spinner"></div><span>${t('podcast.generatingAudio')}</span>`;
      statusEl.className = 'podcast-status';
      statusEl.style.display = '';
      playerEl.classList.remove('active');
      break;
    case 'playing':
      statusEl.style.display = 'none';
      playerEl.classList.add('active');
      addDownloadButton(card);
      break;
    case 'done':
      statusEl.innerHTML = `<span>${t('podcast.done')}</span> <button class="podcast-action-btn podcast-replay-btn">${t('podcast.replay')}</button> <button class="podcast-action-btn podcast-download-btn">${t('podcast.download')}</button>`;
      statusEl.className = 'podcast-status';
      statusEl.style.display = '';
      playerEl.classList.remove('active');
      card.querySelector('.podcast-replay-btn').addEventListener('click', () => replayAudio());
      card.querySelector('.podcast-download-btn').addEventListener('click', () => downloadPodcastAudio());
      break;
    case 'error':
      statusEl.innerHTML = `<span class="podcast-status-error">${escapeHtml(text || t('podcast.error'))}</span> <button class="podcast-action-btn podcast-retry-btn">${t('podcast.retry')}</button>`;
      statusEl.className = 'podcast-status';
      statusEl.style.display = '';
      playerEl.classList.remove('active');
      card.querySelector('.podcast-retry-btn').addEventListener('click', () => {
        cleanupPodcast();
        card.remove();
        handlePodcastClick();
      });
      break;
  }
}

// --- LLM Script Generation ---

async function generatePodcastScript(card, textContent) {
  const port = chrome.runtime.connect({ name: 'podcast-llm' });
  podcastLlmPort = port;

  let fullScript = '';

  port.postMessage({
    type: 'generate',
    prompt: PODCAST_PROMPT,
    text: textContent
  });

  return new Promise((resolve) => {
    port.onMessage.addListener((msg) => {
      if (msg.type === 'chunk' && msg.content) {
        fullScript += msg.content;
      } else if (msg.type === 'done') {
        port.disconnect();
        podcastLlmPort = null;
        if (!podcastCancelled) onScriptDone(card, fullScript);
        resolve();
      } else if (msg.type === 'error') {
        port.disconnect();
        podcastLlmPort = null;
        if (!podcastCancelled) {
          const errMsg = msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.error'));
          updateCardStatus(card, 'error', errMsg);
          resetPodcastState();
        }
        resolve();
      }
    });

    // Safety net: handle unexpected port disconnect during script generation
    port.onDisconnect.addListener(() => {
      podcastLlmPort = null;
      if (podcastCancelled) { resolve(); return; }
      if (state.getIsPodcastGenerating()) {
        if (!fullScript) {
          updateCardStatus(card, 'error', t('podcast.error'));
          resetPodcastState();
          resolve();
        } else {
          // Partial script received — try to parse and proceed, or show error
          try {
            const nlpTexts = parsePodcastScript(fullScript);
            updateCardStatus(card, 'generating_audio');
            generatePodcastAudio(card, nlpTexts);
          } catch {
            updateCardStatus(card, 'error', t('podcast.scriptParseError'));
            resetPodcastState();
          }
          resolve();
        }
      }
    });
  });
}

// --- Script Parsing ---

function parsePodcastScript(fullScript) {
  // Step 1: Extract JSON from LLM output
  let jsonStr = fullScript.trim();
  // Strip markdown code block if present
  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) jsonStr = codeBlock[1].trim();
  // Extract the JSON object containing "rounds"
  const jsonMatch = jsonStr.match(/\{[\s\S]*"rounds"[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in script');
  jsonStr = jsonMatch[0];

  // Step 2: Try direct parse
  try {
    return validateAndMapRounds(JSON.parse(jsonStr));
  } catch (originalError) {
    // Step 3: Repair common LLM JSON issues (trailing commas, unescaped newlines)
    const repaired = repairLLMJson(jsonStr);
    try {
      return validateAndMapRounds(JSON.parse(repaired));
    } catch {
      // Step 4: Last resort — extract rounds individually with state machine
      const rounds = extractRoundsFallback(jsonStr);
      if (rounds.length > 0) return rounds;
      throw new Error(`Invalid JSON: ${originalError.message}`);
    }
  }
}

function validateAndMapRounds(parsed) {
  if (!parsed.rounds || !Array.isArray(parsed.rounds) || parsed.rounds.length === 0) {
    throw new Error('Empty rounds array');
  }
  return parsed.rounds.map(round => {
    if (!round.speaker || !round.text) {
      throw new Error('Missing speaker or text in round');
    }
    const speaker = SPEAKER_MAP[round.speaker] || SPEAKER_MAP[round.speaker?.toUpperCase()] || DEFAULT_SPEAKER;
    const text = (round.text || '').slice(0, 300);
    return { speaker, text };
  });
}

/** Fix common JSON issues in LLM output: trailing commas, unescaped control chars in strings */
function repairLLMJson(jsonStr) {
  // Fix trailing commas before ] or }
  let result = jsonStr.replace(/,\s*([}\]])/g, '$1');
  // Escape unescaped control characters within string values
  let inString = false, escaped = false, output = '';
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escaped) { output += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { output += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; output += ch; continue; }
    if (inString) {
      if (ch === '\n') { output += '\\n'; continue; }
      if (ch === '\r') { output += '\\r'; continue; }
      if (ch === '\t') { output += '\\t'; continue; }
    }
    output += ch;
  }
  return output;
}

/** Fallback: extract rounds individually using state-machine parsing to tolerate broken JSON */
function extractRoundsFallback(jsonStr) {
  const rounds = [];
  const speakerRe = /"speaker"\s*:\s*"(A|B)"/g;
  let m;
  while ((m = speakerRe.exec(jsonStr)) !== null) {
    const letter = m[1];
    const rest = jsonStr.substring(m.index + m[0].length);
    const prefix = rest.match(/^\s*,\s*"text"\s*:\s*"/);
    if (!prefix) continue;
    const src = rest.substring(prefix[0].length);
    // Read text value until unescaped " followed by } (end of round object)
    let text = '', i = 0;
    while (i < src.length) {
      if (src[i] === '\\') { text += src.substring(i, i + 2); i += 2; continue; }
      if (src[i] === '"' && /^\s*\}/.test(src.substring(i + 1))) break;
      text += src[i]; i++;
    }
    text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
               .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const speaker = SPEAKER_MAP[letter] || DEFAULT_SPEAKER;
    text = text.slice(0, 300);
    if (text) rounds.push({ speaker, text });
  }
  return rounds;
}

async function onScriptDone(card, fullScript) {
  if (podcastCancelled) return;

  let nlpTexts;
  try {
    nlpTexts = parsePodcastScript(fullScript);
  } catch (e) {
    console.error('[Podcast] Script parsing error:', e);
    updateCardStatus(card, 'error', `${t('podcast.scriptParseError')} (${e.message})`);
    resetPodcastState();
    return;
  }

  // Transition to audio generation phase
  updateCardStatus(card, 'generating_audio');
  await generatePodcastAudio(card, nlpTexts);
}

// --- Audio Generation ---

async function generatePodcastAudio(card, nlpTexts) {
  if (podcastCancelled) return;

  // Clean up any previous podcast playback before starting new one
  cleanupPodcast();

  podcastPort = chrome.runtime.connect({ name: 'podcast-audio' });

  podcastPort.postMessage({
    type: 'generate',
    nlpTexts,
    audioConfig: {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 0
    }
  });

  podcastPort.onMessage.addListener((msg) => {
    // Guard against cancelled or disconnected port
    if (!podcastPort || podcastCancelled) return;

    if (msg.type === 'audio_chunk' && msg.data) {
      if (!podcastAudioEl) {
        initPodcastPlayback(card);
      }
      // Decode base64 and append to SourceBuffer
      const binaryStr = atob(msg.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Apply backpressure: drop old chunks if queue is too large
      if (podcastChunkQueue.length >= MAX_CHUNK_QUEUE_SIZE) {
        console.warn('[Podcast] Queue full, dropping oldest chunk');
        podcastChunkQueue.shift();
      }
      podcastChunkQueue.push(bytes.buffer);
      podcastAudioChunks.push(bytes.buffer.slice(0));
      appendPodcastChunk();
    } else if (msg.type === 'round_end' && msg.audioDuration) {
      // Track duration for progress display
    } else if (msg.type === 'done') {
      finishPodcastAudio(card);
    } else if (msg.type === 'error') {
      const errMsg = msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.audioError'));
      updateCardStatus(card, 'error', errMsg);
      resetPodcastState();
    }
  });

  // Safety net: handle unexpected port disconnect (e.g., service worker terminated)
  podcastPort.onDisconnect.addListener(() => {
    if (podcastCancelled) return;
    if (state.getIsPodcastGenerating()) {
      if (podcastAudioEl && podcastMediaSource && podcastMediaSource.readyState === 'open') {
        // Audio already streaming — finalize MediaSource so buffered data plays to completion
        try { podcastMediaSource.endOfStream(); } catch {}
        // The 'ended' event on the audio element will update the card to 'done' status
        resetPodcastState();
      } else {
        updateCardStatus(card, 'error', t('podcast.audioError'));
        resetPodcastState();
      }
    }
  });
}

// --- Audio Playback (MediaSource) ---

function initPodcastPlayback(card) {
  // Clean up any existing audio element before creating new one
  if (podcastAudioEl) {
    podcastAudioEl.pause();
    podcastAudioEl.src = '';
    podcastAudioEl = null;
  }
  if (podcastMediaSource) {
    try { if (podcastMediaSource.readyState === 'open') podcastMediaSource.endOfStream(); } catch {}
    podcastMediaSource = null;
    podcastSourceBuffer = null;
  }
  podcastChunkQueue = [];
  podcastBufferAppending = false;

  const ms = new MediaSource();
  podcastMediaSource = ms;

  const audio = new Audio();
  audio.src = URL.createObjectURL(ms);
  podcastAudioEl = audio;

  ms.addEventListener('sourceopen', () => {
    if (podcastMediaSource !== ms) return;
    if (ms.sourceBuffers.length > 0) return;

    podcastSourceBuffer = ms.addSourceBuffer('audio/mpeg');
    podcastSourceBuffer.addEventListener('updateend', () => {
      podcastBufferAppending = false;
      // Auto-play on first data
      if (podcastAudioEl && podcastAudioEl.paused && podcastSourceBuffer.buffered.length > 0) {
        podcastAudioEl.play().catch(() => {});
      }
      appendPodcastChunk();
    });
  });

  audio.addEventListener('timeupdate', () => {
    updatePlayerProgress(card);
  });

  audio.addEventListener('ended', () => {
    updateCardStatus(card, 'done');
  });

  updateCardStatus(card, 'playing');
}

function appendPodcastChunk() {
  if (!podcastSourceBuffer || podcastBufferAppending || podcastChunkQueue.length === 0) return;
  podcastBufferAppending = true;
  const chunk = podcastChunkQueue.shift();
  try {
    podcastSourceBuffer.appendBuffer(chunk);
  } catch (e) {
    console.error('[Podcast] appendBuffer error:', e);
    podcastBufferAppending = false;
  }
}

function updatePlayerProgress(card) {
  if (!podcastAudioEl) return;
  const fill = card.querySelector('.podcast-progress-fill');
  const timeEl = card.querySelector('.podcast-time');
  const playBtn = card.querySelector('.podcast-play-btn');

  if (podcastAudioEl.duration && isFinite(podcastAudioEl.duration)) {
    const pct = (podcastAudioEl.currentTime / podcastAudioEl.duration) * 100;
    if (fill) fill.style.width = pct + '%';
    if (timeEl) {
      timeEl.textContent = `${formatTime(podcastAudioEl.currentTime)} / ${formatTime(podcastAudioEl.duration)}`;
    }
  }

  if (playBtn) {
    if (podcastAudioEl.paused) {
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      playBtn.title = t('podcast.play');
    } else {
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
      playBtn.title = t('podcast.pause');
    }
  }
}

function handlePlayPause() {
  if (!podcastAudioEl || podcastPlayTransitioning) return;
  
  podcastPlayTransitioning = true;
  setTimeout(() => { podcastPlayTransitioning = false; }, 300);
  
  if (podcastAudioEl.paused) {
    podcastAudioEl.play().catch(() => {});
  } else {
    podcastAudioEl.pause();
  }
}

function addDownloadButton(card) {
  if (card.querySelector('.podcast-download-btn')) return;
  const playerRow = card.querySelector('.podcast-player-row');
  if (!playerRow) return;
  const btn = document.createElement('button');
  btn.className = 'podcast-download-inline-btn';
  btn.title = t('podcast.download');
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  btn.addEventListener('click', downloadPodcastAudio);
  playerRow.appendChild(btn);
}

function downloadPodcastAudio() {
  if (podcastAudioChunks.length === 0) return;
  const blob = new Blob(podcastAudioChunks, { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${t('podcast.fileName')}-${new Date().toISOString().slice(0, 10)}.mp3`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function replayAudio() {
  if (podcastAudioEl) {
    podcastAudioEl.currentTime = 0;
    podcastAudioEl.play().catch(() => {});
    if (_currentCard) updateCardStatus(_currentCard, 'playing');
  }
}

function finishPodcastAudio(card) {
  if (podcastMediaSource && podcastMediaSource.readyState === 'open') {
    try { podcastMediaSource.endOfStream(); } catch {}
  }
  if (podcastAudioEl && podcastAudioEl.ended) {
    updateCardStatus(card, 'done');
  }
  resetPodcastState();
}

// --- Cleanup ---

function cleanupPodcast() {
  if (podcastAudioEl) {
    podcastAudioEl.pause();
    podcastAudioEl.src = '';
    podcastAudioEl = null;
  }
  if (podcastMediaSource) {
    try { if (podcastMediaSource.readyState === 'open') podcastMediaSource.endOfStream(); } catch {}
    podcastMediaSource = null;
    podcastSourceBuffer = null;
  }
  if (podcastPort) {
    try { podcastPort.disconnect(); } catch {}
    podcastPort = null;
  }
  if (podcastLlmPort) {
    try { podcastLlmPort.disconnect(); } catch {}
    podcastLlmPort = null;
  }
  podcastChunkQueue = [];
  podcastAudioChunks = [];
  podcastBufferAppending = false;
  resetPodcastState();
}

function resetPodcastState() {
  state.setIsPodcastGenerating(false);
  if (_podcastBtn) _podcastBtn.disabled = false;
}

// --- Utilities ---

function restoreWelcomeIfNeeded() {
  if (_chatArea.children.length === 0) {
    const welcome = document.createElement('div');
    welcome.className = 'welcome-msg';
    welcome.innerHTML = `<p data-i18n="sidebar.welcome">${t('sidebar.welcome')}</p>`;
    _chatArea.appendChild(welcome);
  }
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
