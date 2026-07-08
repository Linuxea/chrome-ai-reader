import { t } from '../../../shared/i18n.js';
import { escapeHtml } from '../../../shared/constants';
import { scrollToBottom } from '../../ui/dom-helpers';
import type { NowPlaying } from './now-playing';

let _lastHighlightIdx = -1;
let _cardHandlers: { onClose: (card: HTMLElement) => void; onPlayPause: () => void; onSeekMouse: (e: MouseEvent, card: HTMLElement, bar: HTMLElement) => void; onSeekTouch: (e: TouchEvent, card: HTMLElement, bar: HTMLElement) => void } | null = null;
let _statusHandlers: { addDownloadButton: (card: HTMLElement) => void; replayAudio: () => void; downloadPodcastAudio: () => void; cleanupPodcast: () => void; handlePodcastClick: () => void } | null = null;

export function initUICallbacks(deps: { cardHandlers: typeof _cardHandlers; statusHandlers: typeof _statusHandlers }): void {
  _cardHandlers = deps.cardHandlers;
  _statusHandlers = deps.statusHandlers;
}

export function resetHighlightState(): void { _lastHighlightIdx = -1; }

interface NlpRound { speaker: string; text: string; speakerLabel: string; }

export function createPodcastCard(quotePreview: string | null, chatArea: HTMLElement): HTMLElement {
  const existing = chatArea.querySelector('.podcast-card'); if (existing) existing.remove();
  const welcome = chatArea.querySelector('.welcome-msg'); if (welcome) welcome.remove();
  const card = document.createElement('div'); card.className = 'podcast-card';
  const quoteHtml = quotePreview ? `<blockquote class="podcast-quote">${escapeHtml(quotePreview)}</blockquote>` : '';
  card.innerHTML = `<div class="podcast-card-header"><span class="podcast-card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> ${t('podcast.cardTitle')}</span><button class="podcast-card-close" title="${t('podcast.close')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div><div class="podcast-info"><h3 class="podcast-info-title"></h3><p class="podcast-info-desc"></p></div>${quoteHtml}<div class="podcast-status" data-status="generating_script"><div class="podcast-status-spinner"></div><span>${t('podcast.generatingScript')}</span></div><div class="podcast-player"><div class="podcast-player-row"><button class="podcast-play-btn" title="${t('podcast.play')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button><div class="podcast-progress-bar"><div class="podcast-progress-fill"></div><div class="podcast-progress-thumb"></div></div><span class="podcast-time">0:00 / 0:00</span></div></div>`;
  card.querySelector('.podcast-card-close')!.addEventListener('click', () => _cardHandlers!.onClose(card));
  card.querySelector('.podcast-play-btn')!.addEventListener('click', _cardHandlers!.onPlayPause);
  const progressBar = card.querySelector('.podcast-progress-bar') as HTMLElement;
  let isDragging = false;
  progressBar.addEventListener('mousedown', (e) => {
    e.preventDefault(); isDragging = true; progressBar.classList.add('dragging'); _cardHandlers!.onSeekMouse(e, card, progressBar);
    const onMove = (ev: MouseEvent) => { if (isDragging) _cardHandlers!.onSeekMouse(ev, card, progressBar); };
    const onUp = (ev: MouseEvent) => { if (!isDragging) return; isDragging = false; progressBar.classList.remove('dragging'); _cardHandlers!.onSeekMouse(ev, card, progressBar); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
  progressBar.addEventListener('touchstart', (e) => { e.preventDefault(); isDragging = true; progressBar.classList.add('dragging'); _cardHandlers!.onSeekTouch(e, card, progressBar); }, { passive: false });
  progressBar.addEventListener('touchmove', (e) => { if (isDragging) { e.preventDefault(); _cardHandlers!.onSeekTouch(e, card, progressBar); } }, { passive: false });
  progressBar.addEventListener('touchend', (e) => { if (!isDragging) return; isDragging = false; progressBar.classList.remove('dragging'); _cardHandlers!.onSeekTouch(e, card, progressBar); });
  chatArea.appendChild(card); scrollToBottom();
  return card;
}

export function renderTranscript(card: HTMLElement, rounds: NlpRound[]): void {
  const existing = card.querySelector('.podcast-transcript'); if (existing) existing.remove();
  const container = document.createElement('div'); container.className = 'podcast-transcript';
  const COLLAPSED_LIMIT = 4;
  rounds.forEach((round, idx) => {
    const el = document.createElement('div'); el.className = 'podcast-round'; el.dataset.round = String(idx);
    if (idx >= COLLAPSED_LIMIT) el.classList.add('podcast-round-hidden');
    el.innerHTML = `<span class="podcast-round-speaker speaker-${round.speakerLabel}">${round.speakerLabel}</span><span class="podcast-round-text">${escapeHtml(round.text)}</span>`;
    container.appendChild(el);
  });
  if (rounds.length > COLLAPSED_LIMIT) {
    const toggle = document.createElement('button'); toggle.className = 'podcast-transcript-toggle'; toggle.textContent = t('podcast.showMore');
    toggle.addEventListener('click', () => {
      const isCollapsed = container.classList.contains('podcast-transcript-collapsed');
      container.classList.toggle('podcast-transcript-collapsed', !isCollapsed);
      toggle.textContent = isCollapsed ? t('podcast.showMore') : t('podcast.showLess');
      if (isCollapsed) container.querySelectorAll('.podcast-round-hidden').forEach(el => el.classList.remove('podcast-round-hidden'));
      else container.querySelectorAll('.podcast-round').forEach((el, i) => { if (i >= COLLAPSED_LIMIT) el.classList.add('podcast-round-hidden'); });
    });
    container.classList.add('podcast-transcript-collapsed'); container.appendChild(toggle);
  }
  const statusEl = card.querySelector('.podcast-status')!;
  card.insertBefore(container, statusEl);
}

export function updateTranscriptHighlight(roundIdx: number, currentCard: HTMLElement | null): void {
  if (roundIdx < 0 || roundIdx === _lastHighlightIdx) return;
  _lastHighlightIdx = roundIdx;
  if (!currentCard) return;
  const container = currentCard.querySelector('.podcast-transcript');
  const rounds = currentCard.querySelectorAll('.podcast-round');
  if (!container || rounds.length === 0) return;
  if (container.classList.contains('podcast-transcript-collapsed')) {
    container.classList.remove('podcast-transcript-collapsed');
    container.querySelectorAll('.podcast-round-hidden').forEach(el => el.classList.remove('podcast-round-hidden'));
    const toggle = container.querySelector('.podcast-transcript-toggle'); if (toggle) toggle.textContent = t('podcast.showLess');
  }
  rounds.forEach((el, i) => { el.classList.toggle('active', i === roundIdx); });
  const activeEl = rounds[roundIdx]; if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function updateCardStatus(card: HTMLElement, status: string, text?: string): void {
  const statusEl = card.querySelector('.podcast-status') as HTMLElement;
  const playerEl = card.querySelector('.podcast-player') as HTMLElement;
  switch (status) {
    case 'generating_script': statusEl.innerHTML = `<div class="podcast-status-spinner"></div><span>${t('podcast.generatingScript')}</span>`; statusEl.className = 'podcast-status'; statusEl.style.display = ''; playerEl.classList.remove('active'); break;
    case 'generating_audio': statusEl.innerHTML = `<div class="podcast-status-spinner"></div><span>${t('podcast.generatingAudio')}</span>`; statusEl.className = 'podcast-status'; statusEl.style.display = ''; playerEl.classList.remove('active'); break;
    case 'playing': statusEl.style.display = 'none'; playerEl.classList.add('active'); _statusHandlers!.addDownloadButton(card); break;
    case 'done':
      statusEl.innerHTML = `<span>${t('podcast.done')}</span> <button class="podcast-action-btn podcast-replay-btn">${t('podcast.replay')}</button> <button class="podcast-action-btn podcast-download-btn">${t('podcast.download')}</button>`;
      statusEl.className = 'podcast-status'; statusEl.style.display = ''; playerEl.classList.remove('active');
      card.querySelector('.podcast-replay-btn')!.addEventListener('click', () => _statusHandlers!.replayAudio());
      card.querySelector('.podcast-download-btn')!.addEventListener('click', () => _statusHandlers!.downloadPodcastAudio());
      break;
    case 'error':
      statusEl.innerHTML = `<span class="podcast-status-error">${escapeHtml(text || t('podcast.error'))}</span> <button class="podcast-action-btn podcast-retry-btn">${t('podcast.retry')}</button>`;
      statusEl.className = 'podcast-status'; statusEl.style.display = ''; playerEl.classList.remove('active');
      card.querySelector('.podcast-retry-btn')!.addEventListener('click', () => { _statusHandlers!.cleanupPodcast(); card.remove(); _statusHandlers!.handlePodcastClick(); });
      break;
  }
}

export function restoreWelcomeIfNeeded(chatArea: HTMLElement): void {
  if (chatArea.children.length === 0) {
    const welcome = document.createElement('div'); welcome.className = 'welcome-msg';
    welcome.innerHTML = `<p data-i18n="sidebar.welcome">${t('sidebar.welcome')}</p>`;
    chatArea.appendChild(welcome);
  }
}

/**
 * Rebuild the full podcast card from saved now-playing metadata when the user
 * returns to the origin tab. Reuses createPodcastCard (which re-wires all
 * play/seek/close handlers) then restores the title, transcript and status.
 * Audio progress is re-synced separately by audio.ts `reattachCard`.
 */
export function rebuildPodcastCard(np: NowPlaying, chatArea: HTMLElement): HTMLElement {
  const card = createPodcastCard(np.sourcePreview ?? null, chatArea);
  if (np.title) {
    const infoEl = card.querySelector('.podcast-info');
    const titleEl = card.querySelector('.podcast-info-title');
    const descEl = card.querySelector('.podcast-info-desc');
    if (infoEl && titleEl) { titleEl.textContent = np.title; infoEl.classList.add('active'); }
    if (descEl && np.description) descEl.textContent = np.description;
  }
  if (np.script && np.script.length > 0) renderTranscript(card, np.script);
  if (np.status && np.status !== 'generating_script') {
    updateCardStatus(card, np.status, np.statusText);
  }
  scrollToBottom();
  return card;
}
