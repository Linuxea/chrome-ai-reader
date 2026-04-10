// features/podcast.js — Podcast generation and streaming playback

import { t } from '../../shared/i18n.js';
import * as state from '../state.js';
import { appendMessage, scrollToBottom } from '../ui/dom-helpers.js';
import { extractPageContent } from '../services/ai-chat.js';
import { isTTSPlaying, stopTTS } from '../services/tts.js';

// --- Constants ---

const PODCAST_PROMPT = `你是一位专业的播客节目制作人。请根据以下内容，生成一段两人对话的播客脚本。

要求：
1. 两位主播分别为"主播A"和"主播B"
2. 对话风格自然、生动，像真实的播客节目
3. 总共生成 8-15 轮对话
4. 每轮对话不超过 300 字
5. 请严格按以下 JSON 格式输出，不要输出其他内容：

{"rounds":[{"speaker":"A","text":"对话内容"},{"speaker":"B","text":"对话内容"}]}

待处理的内容：`;

// Speaker mapping: script labels → Volcengine speaker IDs
const SPEAKER_MAP = {
  'A': 'zh_male_jnqg_24k_vq_bigtts',
  'B': 'zh_female_vv_uranus_bigtts',
};
const DEFAULT_SPEAKER = 'zh_female_vv_uranus_bigtts';

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

  // Truncate to avoid exceeding limits
  const truncated = textContent.slice(0, 10000);

  // Create podcast card
  const card = createPodcastCard();
  _currentCard = card;

  // Disable button during generation
  state.setIsPodcastGenerating(true);
  if (_podcastBtn) _podcastBtn.disabled = true;

  // Start LLM script generation
  await generatePodcastScript(card, truncated);
}

// --- Podcast card UI ---

function createPodcastCard() {
  // Remove existing podcast card if any
  const existing = _chatArea.querySelector('.podcast-card');
  if (existing) existing.remove();

  // Remove welcome message if present
  const welcome = _chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const card = document.createElement('div');
  card.className = 'podcast-card';

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
      break;
    case 'done':
      statusEl.innerHTML = `<span>${t('podcast.done')}</span> <button class="podcast-action-btn podcast-replay-btn">${t('podcast.replay')}</button>`;
      statusEl.className = 'podcast-status';
      statusEl.style.display = '';
      playerEl.classList.remove('active');
      card.querySelector('.podcast-replay-btn').addEventListener('click', () => replayAudio());
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

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.rounds || !Array.isArray(parsed.rounds) || parsed.rounds.length === 0) {
    throw new Error('Empty rounds array');
  }

  return parsed.rounds.map(round => {
    const speaker = SPEAKER_MAP[round.speaker] || SPEAKER_MAP[round.speaker?.toUpperCase()] || DEFAULT_SPEAKER;
    const text = (round.text || '').slice(0, 300);
    return { speaker, text };
  });
}

async function onScriptDone(card, fullScript) {
  let nlpTexts;
  try {
    nlpTexts = parsePodcastScript(fullScript);
  } catch {
    updateCardStatus(card, 'error', t('podcast.scriptParseError'));
    resetPodcastState();
    return;
  }

  // Transition to audio generation phase
  updateCardStatus(card, 'generating_audio');
  await generatePodcastAudio(card, nlpTexts);
}

// --- Audio Generation ---

async function generatePodcastAudio(card, nlpTexts) {
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
      podcastChunkQueue.push(bytes.buffer);
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
  if (!podcastAudioEl) return;
  if (podcastAudioEl.paused) {
    podcastAudioEl.play().catch(() => {});
  } else {
    podcastAudioEl.pause();
  }
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
