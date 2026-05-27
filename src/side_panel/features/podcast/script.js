import { t } from '../../../shared/i18n.js';
import { stripMarkdownFence, extractJsonObject, repairLLMJson } from '../../../shared/json-repair.js';
import * as state from '../../state.js';
import { PODCAST_PROMPT, SPEAKER_MAP, DEFAULT_SPEAKER } from './constants.js';
import { renderTranscript, resetHighlightState } from './ui.js';
import { setPodcastTitle, resetRoundTimings, generatePodcastAudio } from './audio.js';

let podcastLlmPort = null;

let _showStatus = null;
let _resetPodcastState = null;
let _isCancelled = null;

export function initScriptCallbacks({ showStatus, resetPodcastState, isCancelled }) {
  _showStatus = showStatus;
  _resetPodcastState = resetPodcastState;
  _isCancelled = isCancelled;
}

export function cleanupScriptPort() {
  if (podcastLlmPort) {
    try { podcastLlmPort.disconnect(); } catch {}
    podcastLlmPort = null;
  }
}

export function parsePodcastScript(fullScript) {
  let jsonStr = stripMarkdownFence(fullScript);
  const jsonMatch = extractJsonObject(jsonStr, 'rounds');
  if (!jsonMatch) throw new Error('No JSON found in script');
  jsonStr = jsonMatch;

  try {
    return validateAndMapRounds(JSON.parse(jsonStr));
  } catch (originalError) {
    const repaired = repairLLMJson(jsonStr);
    try {
      return validateAndMapRounds(JSON.parse(repaired));
    } catch {
      const rounds = extractRoundsFallback(jsonStr);
      if (rounds.length > 0) return rounds;
      throw new Error(`Invalid JSON: ${originalError.message}`);
    }
  }
}

export function validateAndMapRounds(parsed) {
  if (!parsed.rounds || !Array.isArray(parsed.rounds) || parsed.rounds.length === 0) {
    throw new Error('Empty rounds array');
  }
  return parsed.rounds.map(round => {
    if (!round.speaker || !round.text) {
      throw new Error('Missing speaker or text in round');
    }
    const speakerLabel = round.speaker.toUpperCase();
    const speaker = SPEAKER_MAP[round.speaker] || SPEAKER_MAP[speakerLabel] || DEFAULT_SPEAKER;
    const text = (round.text || '').slice(0, 300);
    return { speaker, text, speakerLabel };
  });
}

export function extractRoundsFallback(jsonStr) {
  const rounds = [];
  const speakerRe = /"speaker"\s*:\s*"(A|B)"/g;
  let m;
  while ((m = speakerRe.exec(jsonStr)) !== null) {
    const letter = m[1];
    const rest = jsonStr.substring(m.index + m[0].length);
    const prefix = rest.match(/^\s*,\s*"text"\s*:\s*"/);
    if (!prefix) continue;
    const src = rest.substring(prefix[0].length);
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
    if (text) rounds.push({ speaker, text, speakerLabel: letter });
  }
  return rounds;
}

export function extractPodcastTitle(rounds) {
  if (!rounds || rounds.length === 0) return '';
  const firstTexts = rounds.slice(0, 3).map(r => (r.text || '').trim()).filter(Boolean).join(' ');
  let title = firstTexts
    .replace(/[，。！？、；："\'「」『』【】（）《》—…\s]+/g, ' ')
    .trim()
    .slice(0, 60);
  if (title.length > 30) {
    const lastPunct = title.lastIndexOf(' ', 30);
    title = title.slice(0, lastPunct > 0 ? lastPunct : 30);
  }
  return title.replace(/[\/\\:*?"<>|]/g, '_').trim();
}

function generatePodcastMetadata(card, fullScript) {
  const port = chrome.runtime.connect({ name: 'ai-chat' });
  let result = '';
  port.postMessage({
    type: 'chat',
    messages: [
      { role: 'system', content: 'Generate a captivating title and a short summary description for this podcast conversation. Return ONLY valid JSON with two keys: "title" (string, max 30 chars) and "description" (string, max 100 chars, highlighting the core topic).' },
      { role: 'user', content: fullScript.slice(0, 4000) }
    ],
    response_format: { type: 'json_object' }
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'chunk' && msg.content) {
      result += msg.content;
    } else if (msg.type === 'done') {
      port.disconnect();
      if (_isCancelled()) return;
      try {
        const jsonMatch = extractJsonObject(result);
        if (!jsonMatch) return;
        const data = JSON.parse(jsonMatch);
        if (data.title) {
          setPodcastTitle(data.title.replace(/[\/\\:*?"<>|]/g, '_').trim());
          const infoEl = card.querySelector('.podcast-info');
          const titleEl = card.querySelector('.podcast-info-title');
          const descEl = card.querySelector('.podcast-info-desc');
          if (infoEl && titleEl && descEl) {
            titleEl.textContent = data.title;
            if (data.description) descEl.textContent = data.description;
            infoEl.classList.add('active');
          }
        }
      } catch (e) {
        console.error('[Podcast] Failed to parse metadata:', e);
      }
    }
  });
}

async function onScriptDone(card, fullScript) {
  if (_isCancelled()) return;

  let nlpTexts;
  try {
    nlpTexts = parsePodcastScript(fullScript);
  } catch (e) {
    console.error('[Podcast] Script parsing error:', e);
    _showStatus(card, 'error', `${t('podcast.scriptParseError')} (${e.message})`);
    _resetPodcastState();
    return;
  }

  setPodcastTitle(extractPodcastTitle(nlpTexts));

  resetRoundTimings();
  resetHighlightState();
  renderTranscript(card, nlpTexts);

  generatePodcastMetadata(card, fullScript);

  _showStatus(card, 'generating_audio');
  await generatePodcastAudio(card, nlpTexts);
}

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
        if (!_isCancelled()) onScriptDone(card, fullScript);
        resolve();
      } else if (msg.type === 'error') {
        port.disconnect();
        podcastLlmPort = null;
        if (!_isCancelled()) {
          const errMsg = msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.error'));
          _showStatus(card, 'error', errMsg);
          _resetPodcastState();
        }
        resolve();
      }
    });

    port.onDisconnect.addListener(() => {
      podcastLlmPort = null;
      if (_isCancelled()) { resolve(); return; }
      if (state.getIsPodcastGenerating()) {
        if (!fullScript) {
          _showStatus(card, 'error', t('podcast.error'));
          _resetPodcastState();
          resolve();
        } else {
          try {
            const nlpTexts = parsePodcastScript(fullScript);
            _showStatus(card, 'generating_audio');
            generatePodcastAudio(card, nlpTexts);
          } catch {
            _showStatus(card, 'error', t('podcast.scriptParseError'));
            _resetPodcastState();
          }
          resolve();
        }
      }
    });
  });
}

export { generatePodcastScript };
