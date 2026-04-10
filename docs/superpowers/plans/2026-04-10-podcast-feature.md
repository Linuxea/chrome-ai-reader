# Podcast Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a podcast button to the quick actions area that generates a two-person podcast from page content via LLM + Volcengine Podcast API, with streaming audio playback in a dedicated card.

**Architecture:** Two-phase pipeline — (1) LLM generates a structured dialogue script via existing SSE streaming, (2) parsed script is sent to Volcengine Podcast WebSocket API for audio synthesis. Uses dual Chrome runtime ports (`podcast-llm` and `podcast-audio`) following existing patterns. Audio playback uses MediaSource Extensions like the existing TTS system.

**Tech Stack:** Chrome Extension (Manifest V3), Vite + Rollup, vanilla JS ES Modules, WebSocket binary protocol, MediaSource Extensions, Chrome runtime ports.

**Design Spec:** `docs/superpowers/specs/2026-04-10-podcast-feature-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/side_panel/state.js` | Modify | Add `isPodcastGenerating` state getter/setter |
| `src/shared/i18n.js` | Modify | Add podcast translation strings (zh + en) |
| `src/side_panel/index.html` | Modify | Add podcast button to quick actions, link podcast.css |
| `src/side_panel/podcast.css` | Create | Podcast card styles, loading animation, player controls |
| `src/side_panel/features/podcast.js` | Create | Core podcast logic: card UI, script generation, parsing, audio playback |
| `src/background/service-worker.js` | Modify | Add `podcast-llm` and `podcast-audio` port handlers |
| `src/side_panel/main.js` | Modify | Import and initialize podcast module |

---

### Task 1: State, i18n, and HTML Foundation

**Files:**
- Modify: `src/side_panel/state.js:88` (append after `initState`)
- Modify: `src/shared/i18n.js` (add to both `zh` and `en` translation objects)
- Modify: `src/side_panel/index.html:78-95` (add podcast button), `:9` (add CSS link)

- [ ] **Step 1: Add podcast state to state.js**

Append after line 73 (after `setSuggestQuestionsEnabled`), before `initState()`:

```javascript
let _isPodcastGenerating = false;
export function getIsPodcastGenerating() { return _isPodcastGenerating; }
export function setIsPodcastGenerating(v) { _isPodcastGenerating = v; }
```

- [ ] **Step 2: Add podcast i18n strings**

In `src/shared/i18n.js`, add the following keys to the `zh` object (after the existing `prompt.keyInfo.quote` entry around line 161):

```javascript
// Podcast
'podcast.button': '播客',
'podcast.cardTitle': '播客',
'podcast.generatingScript': '正在生成对话脚本...',
'podcast.generatingAudio': '正在合成播客音频...',
'podcast.play': '播放',
'podcast.pause': '暂停',
'podcast.done': '播放完成',
'podcast.replay': '重新播放',
'podcast.error': '生成失败',
'podcast.retry': '重试',
'podcast.noContent': '没有可用的页面内容',
'podcast.noTtsConfig': '请先在设置中配置 TTS 语音合成凭证',
'podcast.scriptParseError': '对话脚本格式异常，无法生成播客',
'podcast.audioError': '播客音频合成失败',
```

And to the `en` object (after the corresponding `prompt.keyInfo.quote` entry):

```javascript
// Podcast
'podcast.button': 'Podcast',
'podcast.cardTitle': 'Podcast',
'podcast.generatingScript': 'Generating script...',
'podcast.generatingAudio': 'Synthesizing audio...',
'podcast.play': 'Play',
'podcast.pause': 'Pause',
'podcast.done': 'Playback complete',
'podcast.replay': 'Replay',
'podcast.error': 'Generation failed',
'podcast.retry': 'Retry',
'podcast.noContent': 'No page content available',
'podcast.noTtsConfig': 'Please configure TTS credentials in settings first',
'podcast.scriptParseError': 'Script format error, cannot generate podcast',
'podcast.audioError': 'Podcast audio synthesis failed',
```

- [ ] **Step 3: Add podcast button HTML and CSS link**

In `src/side_panel/index.html`, add the CSS link after line 10 (after `outline.css`):

```html
  <link rel="stylesheet" href="podcast.css">
```

Add the podcast button inside the `.quick-actions` div, after the outline button (after line 94, before `</div>`):

```html
      <button class="action-btn" data-action="podcast">
        <span class="action-icon">🎙️</span>
        <span data-i18n="podcast.button">播客</span>
      </button>
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/state.js src/shared/i18n.js src/side_panel/index.html
git commit -m "feat(podcast): add state, i18n strings, and button HTML"
```

---

### Task 2: Podcast CSS Styles

**Files:**
- Create: `src/side_panel/podcast.css`

- [ ] **Step 1: Create podcast.css**

Create `src/side_panel/podcast.css` with the following content. The styles follow the same CSS custom properties pattern used in `side_panel.css` for theme compatibility.

```css
/* Podcast card styles */
.podcast-card {
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 12px;
  margin: 8px 0;
  padding: 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  position: relative;
}

.podcast-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.podcast-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
  display: flex;
  align-items: center;
  gap: 6px;
}

.podcast-card-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--text-secondary, #888);
  display: flex;
  align-items: center;
  justify-content: center;
}

.podcast-card-close:hover {
  background: var(--hover-bg, rgba(0,0,0,0.05));
  color: var(--text-primary, #333);
}

/* Status area */
.podcast-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary, #888);
  padding: 4px 0;
}

.podcast-status-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color, #e0e0e0);
  border-top-color: var(--accent-color, #6366f1);
  border-radius: 50%;
  animation: podcast-spin 0.8s linear infinite;
}

@keyframes podcast-spin {
  to { transform: rotate(360deg); }
}

.podcast-status-error {
  color: var(--error-color, #ef4444);
}

/* Player controls */
.podcast-player {
  display: none;
  flex-direction: column;
  gap: 8px;
}

.podcast-player.active {
  display: flex;
}

.podcast-player-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.podcast-play-btn {
  background: var(--accent-color, #6366f1);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.podcast-play-btn:hover {
  opacity: 0.9;
}

.podcast-play-btn svg {
  fill: currentColor;
}

.podcast-progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-color, #e0e0e0);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}

.podcast-progress-fill {
  height: 100%;
  background: var(--accent-color, #6366f1);
  border-radius: 2px;
  width: 0%;
  transition: width 0.3s ease;
}

.podcast-time {
  font-size: 11px;
  color: var(--text-secondary, #888);
  min-width: 80px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Action buttons (retry, replay) */
.podcast-action-btn {
  background: none;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--accent-color, #6366f1);
  cursor: pointer;
}

.podcast-action-btn:hover {
  background: var(--hover-bg, rgba(0,0,0,0.05));
}

/* Disabled state for action button */
.action-btn[data-action="podcast"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Dark mode overrides — uses the same pattern as side_panel.css */
[data-theme="dark"] .podcast-card {
  --bg-secondary: #2a2a2e;
  --border-color: #3a3a3e;
  --text-primary: #e0e0e0;
  --text-secondary: #888;
  --hover-bg: rgba(255,255,255,0.05);
  --accent-color: #818cf8;
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/podcast.css
git commit -m "feat(podcast): add podcast card CSS styles"
```

---

### Task 3: Service Worker — Podcast LLM Port

**Files:**
- Modify: `src/background/service-worker.js:262-288` (add `podcast-llm` port handler)

The `podcast-llm` port reuses the existing `callOpenAI` function. The only difference is that the side panel sends a single prompt (not a full conversation), so the service worker wraps it into a messages array with `response_format` to force JSON output.

- [ ] **Step 1: Add podcast-llm port handler**

In `src/background/service-worker.js`, inside the `chrome.runtime.onConnect.addListener` callback, add a new `else if` branch after the `suggest-questions` handler (after line 287, before the closing `})`):

```javascript
  } else if (port.name === 'podcast-llm') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'generate') {
        const messages = [
          { role: 'user', content: `${msg.prompt}\n\n${msg.text}` }
        ];
        await callOpenAI(messages, port, {
          response_format: { type: 'json_object' }
        });
      }
    });
  }
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds. The service worker is bundled by Rollup as IIFE.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.js
git commit -m "feat(podcast): add podcast-llm port handler in service worker"
```

---

### Task 4: Service Worker — Podcast Audio Port (WebSocket)

**Files:**
- Modify: `src/background/service-worker.js` (add `callPodcast` function and `podcast-audio` port handler)

This is the most complex task. It implements the Volcengine Podcast WebSocket v3 binary protocol.

**Key technical details:**
- WebSocket URL: `wss://openspeech.bytedance.com/api/v3/tts/podcast/ws` (to be verified from docs)
- Auth is passed as query parameters since browser WebSocket doesn't support custom headers
- Binary frame format: 4-byte header + 4-byte event code + 4-byte session_id length + session_id + 4-byte payload length + payload

- [ ] **Step 1: Add the `callPodcast` function**

In `src/background/service-worker.js`, add this function after `callSuggestQuestions` (after line 260), before the `chrome.runtime.onConnect.addListener`:

```javascript
// --- Podcast Audio (WebSocket binary protocol) ---

function encodePodcastFrame(eventCode, sessionId, payloadObj) {
  const header = new Uint8Array([0x11, 0x94, 0x10, 0x00]);
  const eventBytes = new Uint8Array(4);
  new DataView(eventBytes.buffer).setUint32(0, eventCode, false);

  const sessionIdBytes = new TextEncoder().encode(sessionId);
  const sessionIdLen = new Uint8Array(4);
  new DataView(sessionIdLen.buffer).setUint32(0, sessionIdBytes.length, false);

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const payloadLen = new Uint8Array(4);
  new DataView(payloadLen.buffer).setUint32(0, payloadBytes.length, false);

  const frame = new Uint8Array(
    header.length + eventBytes.length +
    sessionIdLen.length + sessionIdBytes.length +
    payloadLen.length + payloadBytes.length
  );
  let offset = 0;
  frame.set(header, offset); offset += header.length;
  frame.set(eventBytes, offset); offset += eventBytes.length;
  frame.set(sessionIdLen, offset); offset += sessionIdLen.length;
  frame.set(sessionIdBytes, offset); offset += sessionIdBytes.length;
  frame.set(payloadLen, offset); offset += payloadLen.length;
  frame.set(payloadBytes, offset);
  return frame;
}

function decodePodcastFrame(data) {
  const view = new DataView(data.buffer || data);
  const eventCode = view.getUint32(4, false);

  const sessionIdLen = view.getUint32(8, false);
  const sessionIdBytes = new Uint8Array(data.buffer || data, 12, sessionIdLen);
  const sessionId = new TextDecoder().decode(sessionIdBytes);

  const payloadOffset = 12 + sessionIdLen;
  const payloadLen = view.getUint32(payloadOffset, false);
  const payloadBytes = new Uint8Array(data.buffer || data, payloadOffset + 4, payloadLen);
  const payloadStr = new TextDecoder().decode(payloadBytes);

  let payload = null;
  try { payload = JSON.parse(payloadStr); } catch {}

  return { eventCode, sessionId, payload };
}

async function callPodcast(nlpTexts, audioConfig, port) {
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId']);

  if (!config.ttsAppId || !config.ttsAccessKey) {
    safePostMessage(port, { type: 'error', errorKey: 'podcast.noTtsConfig' });
    return;
  }

  const appId = config.ttsAppId;
  const accessKey = config.ttsAccessKey;
  const resourceId = config.ttsResourceId || 'seed_tts';

  const sessionId = 'podcast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  // Build WebSocket URL with auth as query parameters
  const url = `wss://openspeech.bytedance.com/api/v3/tts/podcast/ws?X-Api-App-Id=${encodeURIComponent(appId)}&X-Api-Access-Key=${encodeURIComponent(accessKey)}&X-Api-Resource-Id=${encodeURIComponent(resourceId)}`;

  try {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    let resolved = false;

    ws.addEventListener('open', () => {
      // Send StartSession with action=3 (dialogue script mode)
      const startPayload = {
        action: 3,
        nlp_texts: nlpTexts,
        audio_config: {
          format: audioConfig?.format || 'mp3',
          sample_rate: audioConfig?.sample_rate || 24000,
          speech_rate: audioConfig?.speech_rate || 0
        },
        speaker_info: {
          random_order: true
        }
      };

      ws.send(encodePodcastFrame(150, sessionId, startPayload));
    });

    ws.addEventListener('message', (event) => {
      const frame = decodePodcastFrame(event.data);

      switch (frame.eventCode) {
        case 150: // SessionStarted
          // Confirmation received, nothing to forward
          break;

        case 360: // PodcastRoundStart
          safePostMessage(port, {
            type: 'round_start',
            idx: frame.payload?.idx,
            speaker: frame.payload?.speaker
          });
          break;

        case 361: // PodcastRoundResponse — audio data
          if (frame.payload?.data) {
            resolved = true;
            safePostMessage(port, { type: 'audio_chunk', data: frame.payload.data });
          } else if (frame.payload) {
            // payload might be base64 string directly
            resolved = true;
            safePostMessage(port, { type: 'audio_chunk', data: frame.payload });
          }
          break;

        case 362: // PodcastRoundEnd
          safePostMessage(port, {
            type: 'round_end',
            audioDuration: frame.payload?.audio_duration,
            startTime: frame.payload?.start_time,
            endTime: frame.payload?.end_time
          });
          break;

        case 363: // PodcastEnd
          // Optional summary event — may not appear
          break;

        case 152: // SessionFinished
          safePostMessage(port, { type: 'done' });
          ws.close();
          break;

        default:
          break;
      }
    });

    ws.addEventListener('error', () => {
      if (!resolved) {
        safePostMessage(port, { type: 'error', errorKey: 'podcast.audioError' });
      }
    });

    ws.addEventListener('close', () => {
      // If closed before sending done, notify error
      if (!resolved) {
        safePostMessage(port, { type: 'error', errorKey: 'podcast.audioError' });
      }
    });

  } catch (e) {
    safePostMessage(port, { type: 'error', error: e.message });
  }
}
```

**Note on auth:** The WebSocket URL passes auth as query parameters (`?X-Api-App-Id=...&X-Api-Access-Key=...`). This is a common pattern for browser WebSocket connections since the standard `WebSocket` API does not support custom HTTP headers. If the Volcengine API does not accept query parameter auth, this will need to be adapted — the error will surface during manual testing as a connection failure.

**Note on the 361 event payload:** The podcast API may return audio data in different formats depending on the exact API version. The code handles both `frame.payload.data` (nested) and `frame.payload` (direct base64 string). This may need adjustment after testing against the real API.

- [ ] **Step 2: Add podcast-audio port handler**

In the `chrome.runtime.onConnect.addListener` callback, add after the `podcast-llm` handler:

```javascript
  } else if (port.name === 'podcast-audio') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'generate') {
        await callPodcast(msg.nlpTexts, msg.audioConfig, port);
      }
    });
  }
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/background/service-worker.js
git commit -m "feat(podcast): add WebSocket podcast audio handler in service worker"
```

---

### Task 5: Podcast Module — Core Structure and Card UI

**Files:**
- Create: `src/side_panel/features/podcast.js`

This is the main podcast feature module. It handles:
- Podcast card UI creation and state transitions
- LLM script generation (connecting to `podcast-llm` port)
- Script parsing (extracting JSON from LLM output)

- [ ] **Step 1: Create the podcast module**

Create `src/side_panel/features/podcast.js`:

```javascript
// features/podcast.js — Podcast generation and streaming playback

import { t } from '../../shared/i18n.js';
import * as state from '../state.js';
import { appendMessage, scrollToBottom } from '../ui/dom-helpers.js';
import { extractPageContent } from '../services/ai-chat.js';

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
let _currentCard = null; // The active podcast card element

// Audio playback state
let podcastPort = null;       // podcast-audio port
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
    const text = (round.text || '').slice(0, 300); // API limit: 300 chars per round
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

  let totalDuration = 0;

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
      totalDuration = msg.endTime || (totalDuration + msg.audioDuration);
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

  // Update play/pause icon
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
  // If audio already ended (short clip), update status immediately
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
```

**Key design decisions:**
- The `initPodcastPlayback` function mirrors the TTS `initTTSPlayback` pattern exactly — MediaSource + SourceBuffer + auto-play on first chunk
- Script parsing uses regex to extract JSON from the LLM output (handles markdown code block wrapping)
- Speaker mapping is hardcoded with sensible defaults from the Volcengine speaker library
- The card's close button calls `cleanupPodcast` which tears down all resources
- The `handlePodcastClick` function reuses the same text source resolution as other quick actions

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/features/podcast.js
git commit -m "feat(podcast): add podcast module with card UI, script generation, and audio playback"
```

---

### Task 6: Integration — Wire Up in main.js

**Files:**
- Modify: `src/side_panel/main.js`

- [ ] **Step 1: Import and initialize podcast module**

In `src/side_panel/main.js`, add the import at the top (after the outline import on line 15):

```javascript
import { initPodcast } from './features/podcast.js';
```

In the `init()` function, add the podcast initialization in the "Features" section (after `initImageInput` on line 91, before the "AI chat" section):

```javascript
  initPodcast({
    chatArea: els.chatArea,
  });
```

- [ ] **Step 2: Handle new chat cleanup**

In the `newChatBtn` click handler (around line 133), the existing cleanup already handles TTS stop. Add podcast cleanup. Find this line:

```javascript
    if (isTTSPlaying()) stopTTS();
```

Add after it:

```javascript
    // Clean up any active podcast card
    const existingPodcast = els.chatArea.querySelector('.podcast-card');
    if (existingPodcast) existingPodcast.remove();
```

Note: The podcast card cleanup here is a simple DOM removal. The `isPodcastGenerating` state will be reset automatically since the podcast module's port listeners will disconnect. For robustness, also reset the state:

```javascript
    if (state.getIsPodcastGenerating()) state.setIsPodcastGenerating(false);
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds. Check that `dist/assets/` contains the bundled code with podcast module included.

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/main.js
git commit -m "feat(podcast): wire up podcast module in main.js"
```

---

### Task 7: TTS Suppression for Podcast

**Files:**
- Modify: `src/side_panel/services/ai-chat.js` (add `isPodcast` guard in `callAI`)

The podcast module does NOT use `callAI` — it has its own `podcast-llm` port. So `callAI` doesn't need modification for TTS suppression in the podcast flow itself.

However, the podcast button click should also stop any currently playing TTS (just like sending a new message does), to prevent audio conflict.

- [ ] **Step 1: Add TTS stop import to podcast module**

In `src/side_panel/features/podcast.js`, add to the imports:

```javascript
import { isTTSPlaying, stopTTS } from '../services/tts.js';
```

In `handlePodcastClick`, add after the initial guard checks (after the `if (state.getIsGenerating() ...)` line):

```javascript
  // Stop any currently playing TTS
  if (isTTSPlaying()) stopTTS();
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/features/podcast.js
git commit -m "feat(podcast): stop TTS playback when starting podcast generation"
```

---

### Task 8: Build Verification and Manual Testing

**Files:** None (testing only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean build with no errors. Verify these files exist:
- `dist/assets/*-*.js` (Vite bundle containing podcast module)
- `dist/background.js` (Rollup IIFE bundle with podcast port handlers)
- `dist/content.js` (unchanged)

- [ ] **Step 2: Load extension in Chrome**

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" → select `dist/`
4. Verify extension loads without errors in the Extensions page

- [ ] **Step 3: Test podcast button appears**

1. Open any webpage
2. Click the extension icon to open the side panel
3. Verify the 「播客」 button appears in the quick actions area (alongside 总结, 翻译, 关键信息, 大纲)

- [ ] **Step 4: Test podcast generation flow**

1. Make sure LLM API key is configured in settings
2. Make sure TTS credentials are configured (App ID, Access Key)
3. Click the 「播客」 button
4. Verify: a podcast card appears with "正在生成对话脚本..." loading state
5. Wait for LLM to generate the script
6. Verify: card transitions to "正在合成播客音频..." state
7. Wait for podcast audio to start streaming
8. Verify: card shows play/pause controls and audio starts playing automatically

- [ ] **Step 5: Test error scenarios**

1. Test with no page content (e.g., on a blank tab) — should show error
2. Test with TTS credentials not configured — should show configuration error
3. Test clicking podcast while one is already generating — button should be disabled

- [ ] **Step 6: Test close and replay**

1. While podcast is playing, click the close (×) button — card should disappear, audio should stop
2. Generate a new podcast and let it complete — "播放完成" + "重新播放" button should appear
3. Click "重新播放" — audio should replay from start

- [ ] **Step 7: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(podcast): address testing findings"
```

---

## Known Risks and Open Questions

1. **WebSocket Auth**: The Volcengine podcast WebSocket API requires auth headers (`X-Api-App-Id`, `X-Api-Access-Key`, `X-Api-Resource-Id`) on the HTTP upgrade request. Browser WebSocket API doesn't support custom headers. The plan uses query parameter auth (`?X-Api-App-Id=...`) as a workaround. This needs verification during testing — if it doesn't work, an alternative auth method or endpoint needs investigation.

2. **WebSocket URL**: The exact podcast WebSocket endpoint URL (`wss://openspeech.bytedance.com/api/v3/tts/podcast/ws`) needs verification from the Volcengine documentation. The docs page title is "播客API-websocket-v3协议" but the exact URL may differ.

3. **Speaker IDs**: The hardcoded speaker IDs (`zh_male_jnqg_24k_vq_bigtts`, `zh_female_vv_uranus_bigtts`) need verification against the Volcengine available speakers list for the podcast API. The podcast API may use a different speaker set than the TTS API.

4. **361 Event Payload Format**: The binary frame for event 361 (PodcastRoundResponse) contains audio data. The exact format of the payload (base64 string vs. raw bytes) needs verification. The code handles both cases.

5. **Resource ID**: The TTS resource ID (`seed-tts-2.0`) is used as fallback for the podcast API. The podcast API likely requires its own resource ID (e.g., `seed_tts` or something specific to podcast).
