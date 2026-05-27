import { t } from '../../../shared/i18n.js';
import * as state from '../../state.js';
import { appendMessage } from '../../ui/dom-helpers.js';
import { extractPageContent } from '../../services/ai-chat.js';
import { isTTSPlaying, stopTTS } from '../../services/tts/index.js';
import { clearImagePreviews } from '../../services/ocr.js';
import {
  createPodcastCard,
  updateCardStatus,
  restoreWelcomeIfNeeded,
  resetHighlightState,
  initUICallbacks,
} from './ui.js';
import {
  handlePlayPause,
  seekToMouse,
  seekToTouch,
  addDownloadButton,
  downloadPodcastAudio,
  replayAudio,
  cleanupPodcastAudio,
  initAudioCallbacks,
} from './audio.js';
import {
  generatePodcastScript,
  cleanupScriptPort,
  initScriptCallbacks,
} from './script.js';

let _chatArea;
let _podcastBtn;
let _currentCard = null;
let podcastCancelled = false;

function resetPodcastState() {
  state.setIsPodcastGenerating(false);
  if (_podcastBtn) _podcastBtn.disabled = false;
}

function cleanupPodcast() {
  cleanupPodcastAudio();
  cleanupScriptPort();
  resetHighlightState();
  resetPodcastState();
}

function showStatus(card, status, text) {
  updateCardStatus(card, status, text);
}

const cardHandlers = {
  onClose: (card) => {
    podcastCancelled = true;
    cleanupPodcast();
    card.remove();
    _currentCard = null;
    restoreWelcomeIfNeeded(_chatArea);
  },
  onPlayPause: handlePlayPause,
  onSeekMouse: seekToMouse,
  onSeekTouch: seekToTouch,
};

const statusHandlers = {
  addDownloadButton,
  replayAudio: () => replayAudio(_currentCard),
  downloadPodcastAudio,
  cleanupPodcast,
  handlePodcastClick: () => handlePodcastClick(),
};

export function initPodcast({ chatArea }) {
  _chatArea = chatArea;
  _podcastBtn = document.querySelector('[data-action="podcast"]');

  initUICallbacks({ cardHandlers, statusHandlers });
  initAudioCallbacks({
    showStatus,
    resetPodcastState,
    isCancelled: () => podcastCancelled,
  });
  initScriptCallbacks({
    showStatus,
    resetPodcastState,
    isCancelled: () => podcastCancelled,
  });

  state.subscribe('isGenerating', (v) => {
    if (_podcastBtn && !state.getIsPodcastGenerating()) {
      _podcastBtn.disabled = v;
    }
  });
}

export async function handlePodcastClick() {
  if (state.getIsGenerating() || state.getIsPodcastGenerating()) return;

  state.setIsPodcastGenerating(true);
  if (_podcastBtn) _podcastBtn.disabled = true;

  podcastCancelled = false;

  if (isTTSPlaying()) stopTTS();
  cleanupPodcast();
  state.setIsPodcastGenerating(true);
  if (_podcastBtn) _podcastBtn.disabled = true;

  const selectedText = state.getSelectedText();
  const hasSelection = selectedText && selectedText.trim().length > 0;

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

  const sourcePreview = hasSelection
    ? selectedText.trim().slice(0, 100) + (selectedText.trim().length > 100 ? '...' : '')
    : '';
  const card = createPodcastCard(sourcePreview, _chatArea);
  _currentCard = card;

  await generatePodcastScript(card, textContent);
}
