import { t } from '../../../shared/i18n.js';
import * as state from '../../state';
import { appendMessage } from '../../ui/dom-helpers';
import { ensurePageContent } from '../../services/page-extractor';
import { isTTSPlaying, stopTTS } from '../../services/tts/index.js';
import { clearImagePreviews } from '../../services/ocr.js';
import { createPodcastCard, updateCardStatus, restoreWelcomeIfNeeded, resetHighlightState, initUICallbacks } from './ui';
import { handlePlayPause, seekToMouse, seekToTouch, addDownloadButton, downloadPodcastAudio, replayAudio, cleanupPodcastAudio, initAudioCallbacks } from './audio';
import { generatePodcastScript, cleanupScriptPort, initScriptCallbacks } from './script';

let _chatArea: HTMLElement;
let _podcastBtn: HTMLButtonElement | null;
let _currentCard: HTMLElement | null = null;
let podcastCancelled = false;

function resetPodcastState(): void { state.setIsPodcastGenerating(false); if (_podcastBtn) _podcastBtn.disabled = false; }
function cleanupPodcast(): void { cleanupPodcastAudio(); cleanupScriptPort(); resetHighlightState(); resetPodcastState(); }
function showStatus(card: HTMLElement, status: string, text?: string): void { updateCardStatus(card, status, text); }

const cardHandlers = {
  onClose: (card: HTMLElement) => { podcastCancelled = true; cleanupPodcast(); card.remove(); _currentCard = null; restoreWelcomeIfNeeded(_chatArea); },
  onPlayPause: handlePlayPause, onSeekMouse: seekToMouse, onSeekTouch: seekToTouch,
};

const statusHandlers = {
  addDownloadButton, replayAudio: () => replayAudio(_currentCard), downloadPodcastAudio,
  cleanupPodcast, handlePodcastClick: () => handlePodcastClick(),
};

export function initPodcast({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
  _podcastBtn = document.querySelector('[data-action="podcast"]');
  initUICallbacks({ cardHandlers, statusHandlers });
  initAudioCallbacks({ showStatus, resetPodcastState, isCancelled: () => podcastCancelled });
  initScriptCallbacks({ showStatus, resetPodcastState, isCancelled: () => podcastCancelled });
  state.subscribe('isGenerating', (v) => { if (_podcastBtn && !state.getIsPodcastGenerating()) _podcastBtn.disabled = v as boolean; });
}

export async function handlePodcastClick(): Promise<void> {
  if (state.getIsGenerating() || state.getIsPodcastGenerating()) return;
  state.setIsPodcastGenerating(true); if (_podcastBtn) _podcastBtn.disabled = true;
  podcastCancelled = false;
  if (isTTSPlaying()) stopTTS();
  cleanupPodcast(); state.setIsPodcastGenerating(true); if (_podcastBtn) _podcastBtn.disabled = true;

  const selectedText = state.getSelectedText();
  const hasSelection = selectedText && selectedText.trim().length > 0;
  const quotePreview = document.getElementById('quotePreview');
  if (quotePreview) quotePreview.classList.add('hidden');
  state.setSelectedText(''); clearImagePreviews();

  // Always ensure the page has been extracted, even when the user selected
  // text — a few sentences are not enough material for a 20-25 round dialogue,
  // so the article body must be available regardless. Selection is still used
  // as the podcast source below when present, but extraction is never skipped.
  const extractResult = await ensurePageContent();
  if (!extractResult.ok) { appendMessage('error', extractResult.error.message); resetPodcastState(); return; }

  let textContent: string | undefined;
  if (hasSelection) { textContent = selectedText.trim(); }
  else { textContent = state.getPageContent(); }

  const ocrResults = state.getOcrResults();
  if (ocrResults?.length) { const ocrText = ocrResults.map(r => r.text).filter(Boolean).join('\n\n'); if (ocrText) textContent = textContent ? textContent + '\n\n' + ocrText : ocrText; }

  if (!textContent?.trim()) { appendMessage('error', t('podcast.noContent')); resetPodcastState(); return; }

  const sourcePreview = hasSelection ? selectedText.trim().slice(0, 100) + (selectedText.trim().length > 100 ? '...' : '') : '';
  const card = createPodcastCard(sourcePreview, _chatArea);
  _currentCard = card;
  await generatePodcastScript(card, textContent);
}
