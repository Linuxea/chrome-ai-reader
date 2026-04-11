// features/podcast.js — Podcast generation and streaming playback

import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
import { appendMessage, scrollToBottom } from '../ui/dom-helpers.js';
import { extractPageContent } from '../services/ai-chat.js';
import { isTTSPlaying, stopTTS } from '../services/tts.js';
import { clearImagePreviews } from '../services/ocr.js';

// --- Constants ---

const PODCAST_PROMPT = `你是一位资深播客制作人。请根据以下内容，生成一段两人深度对话的播客脚本。

【角色设定】
- 主播A（主持人）：负责引导话题、提出关键问题、总结观点，风格严谨但不失亲和
- 主播B（嘉宾）：负责提供深度分析、补充专业视角、提出独到见解，有明确的立场和判断

【结构要求】
- 开场（1-2轮）：简明扼要地引出话题，交代背景
- 深入讨论（6-10轮）：围绕核心观点展开多角度分析，两位主播应有不同侧重点甚至分歧，形成有价值的讨论
- 总结（1-2轮）：归纳关键结论，提出启发性思考或行动建议

【内容要求】
1. 必须忠实于原文信息，不得编造数据或事实
2. 对话要自然口语化，避免书面化长句，可使用"对"、"没错"、"但我觉得"等口语衔接
3. 每轮对话控制在 50-280 字
4. 总共生成 10-15 轮对话
5. 两位主播交替发言，不得连续两轮同一人

请严格按以下 JSON 格式输出，不要输出任何其他内容：
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

// --- Init ---

export function initPodcast({ chatArea }) {
  _chatArea = chatArea;
  _podcastBtn = document.querySelector('[data-action="podcast"]');
  if (_podcastBtn) {
    _podcastBtn.addEventListener('click', handlePodcastClick);
  }
}

// --- Podcast button handler ---

async function handlePodcastClick() {
  if (state.getIsGenerating() || state.getIsPodcastGenerating()) return;

  // Stop any currently playing TTS
  if (isTTSPlaying()) stopTTS();

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
    return;
  }

  // Create podcast card
  const sourcePreview = hasSelection
    ? selectedText.trim().slice(0, 100) + (selectedText.trim().length > 100 ? '...' : '')
    : '';
  const card = createPodcastCard(sourcePreview);
  _currentCard = card;

  // Disable button during generation
  state.setIsPodcastGenerating(true);
  if (_podcastBtn) _podcastBtn.disabled = true;

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
      <button class="podcast-card-close" title="关闭">
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
    cleanupPodcast();
    card.remove();
    _currentCard = null;
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
      statusEl.innerHTML = `<span class="podcast-status-error">${text || t('podcast.error')}</span> <button class="podcast-action-btn podcast-retry-btn">${t('podcast.retry')}</button>`;
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
        onScriptDone(card, fullScript);
        resolve();
      } else if (msg.type === 'error') {
        port.disconnect();
        const errMsg = msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.error'));
        updateCardStatus(card, 'error', errMsg);
        resetPodcastState();
        resolve();
      }
    });
  });
}

// --- Script Parsing ---

function parsePodcastScript(fullScript) {
  // Try to extract JSON — LLM may wrap in markdown code block
  const jsonMatch = fullScript.match(/\{[\s\S]*"rounds"[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in script');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  
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

async function onScriptDone(card, fullScript) {
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
    // Guard against disconnected port
    if (!podcastPort) return;
    
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

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
