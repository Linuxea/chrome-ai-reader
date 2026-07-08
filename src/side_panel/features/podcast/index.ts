import { t } from '../../../shared/i18n.js';
import * as state from '../../state';
import { on, EVENTS } from '../../events';
import { appendMessage } from '../../ui/dom-helpers';
import { ensurePageContent } from '../../services/page-extractor';
import { isTTSPlaying, stopTTS } from '../../services/tts/index.js';
import { clearImagePreviews } from '../../services/ocr.js';
import { createPodcastCard, updateCardStatus, restoreWelcomeIfNeeded, resetHighlightState, initUICallbacks, rebuildPodcastCard } from './ui';
import { handlePlayPause, seekToMouse, seekToTouch, addDownloadButton, downloadPodcastAudio, replayAudio, cleanupPodcastAudio, initAudioCallbacks, reattachCard } from './audio';
import { generatePodcastScript, cleanupScriptPort, initScriptCallbacks } from './script';
import { setNowPlaying, updateNowPlaying, clearNowPlaying, getNowPlaying, isNowPlayingGenerating, type PodcastStatus } from './now-playing';

let _chatArea: HTMLElement;
let _podcastBtn: HTMLButtonElement | null;
let _currentCard: HTMLElement | null = null;
let podcastCancelled = false;

function resetPodcastState(): void {
  // Podcast generation is a window-global single stream, but the flag lives in
  // the per-tab TabState. Clear it on the ORIGIN tab (which may differ from the
  // active tab if the user switched away mid-generation) so the button re-enables
  // correctly when they return. Falls back to the active tab when no origin is
  // tracked yet (e.g. failed before setNowPlaying).
  const np = getNowPlaying();
  if (np?.originTabId != null) {
    const ts = state.getStateForTab(np.originTabId);
    if (ts) { ts.isPodcastGenerating = false; state.persistForTab(np.originTabId); }
  } else {
    state.setIsPodcastGenerating(false);
  }
  if (_podcastBtn) _podcastBtn.disabled = false;
}
function cleanupPodcast(): void { cleanupPodcastAudio(); cleanupScriptPort(); resetHighlightState(); resetPodcastState(); clearNowPlaying(); }
function showStatus(card: HTMLElement, status: string, text?: string): void { updateCardStatus(card, status, text); updateNowPlaying({ status: status as PodcastStatus, statusText: text }); }

const cardHandlers = {
  onClose: (card: HTMLElement) => { closePodcast(); },
  onPlayPause: handlePlayPause, onSeekMouse: seekToMouse, onSeekTouch: seekToTouch,
};

const statusHandlers = {
  addDownloadButton, replayAudio: () => replayAudio(_currentCard), downloadPodcastAudio,
  cleanupPodcast, handlePodcastClick: () => handlePodcastClick(),
};

/** Full teardown: cancel, free audio/script state, drop now-playing, remove any
 *  visible card and restore the welcome message. Used by the card close button
 *  and the mini-player close button. */
export function closePodcast(): void {
  podcastCancelled = true;
  cleanupPodcast();
  const card = _chatArea.querySelector('.podcast-card');
  if (card) card.remove();
  _currentCard = null;
  restoreWelcomeIfNeeded(_chatArea);
}

export function initPodcast({ chatArea }: { chatArea: HTMLElement }): void {
  _chatArea = chatArea;
  _podcastBtn = document.querySelector('[data-action="podcast"]');
  initUICallbacks({ cardHandlers, statusHandlers });
  initAudioCallbacks({ showStatus, resetPodcastState, isCancelled: () => podcastCancelled });
  initScriptCallbacks({ showStatus, resetPodcastState, isCancelled: () => podcastCancelled });
  state.subscribe('isGenerating', (v) => { if (_podcastBtn && !state.getIsPodcastGenerating() && !isNowPlayingGenerating()) _podcastBtn.disabled = v as boolean; });
  // Rebuild the full card when returning to the origin tab after a switch.
  on(EVENTS.PODCAST_REBUILD_REQUEST, () => rebuildCardIfOriginTab());
}

/** Rebuild the full podcast card iff the now-playing podcast originated from
 *  the currently active tab. Called after the chat area is re-rendered. */
export function rebuildCardIfOriginTab(): void {
  const np = getNowPlaying();
  if (!np || np.originTabId !== state.getActiveTabId()) return;
  // A card is already present (e.g. re-render without a switch) — skip.
  if (_chatArea.querySelector('.podcast-card')) return;
  const card = rebuildPodcastCard(np, _chatArea);
  _currentCard = card;
  reattachCard(card);
}

export async function handlePodcastClick(): Promise<void> {
  if (state.getIsGenerating() || state.getIsPodcastGenerating() || isNowPlayingGenerating()) return;
  const originTabId = state.getActiveTabId();
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
  setNowPlaying({ originTabId: originTabId!, originTabTitle: state.getPageTitle() || '', title: '', script: [], status: 'generating_script', sourcePreview });
  const card = createPodcastCard(sourcePreview, _chatArea);
  _currentCard = card;
  await generatePodcastScript(card, textContent);
}
