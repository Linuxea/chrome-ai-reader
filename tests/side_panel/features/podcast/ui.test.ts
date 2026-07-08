/**
 * Tests for side_panel/features/podcast/ui.ts — podcast card DOM + status state machine.
 *
 * Tests: createPodcastCard (DOM structure), renderTranscript (collapse >4 rounds),
 * updateCardStatus (5 status transitions), updateTranscriptHighlight.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../../src/shared/constants.js', () => ({ escapeHtml: (s: string) => s }));
vi.mock('../../../../src/side_panel/ui/dom-helpers.js', () => ({
  scrollToBottom: vi.fn(),
}));

import {
  initUICallbacks,
  resetHighlightState,
  createPodcastCard,
  renderTranscript,
  updateTranscriptHighlight,
  updateCardStatus,
  restoreWelcomeIfNeeded,
  rebuildPodcastCard,
} from '../../../../src/side_panel/features/podcast/ui';

describe('features/podcast/ui', () => {
  let chatArea: HTMLElement;
  let cardHandlers: any;
  let statusHandlers: any;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // jsdom doesn't implement scrollIntoView — stub it on Element.prototype
    Element.prototype.scrollIntoView = vi.fn();
    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);

    cardHandlers = {
      onClose: vi.fn(),
      onPlayPause: vi.fn(),
      onSeekMouse: vi.fn(),
      onSeekTouch: vi.fn(),
    };
    statusHandlers = {
      addDownloadButton: vi.fn(),
      replayAudio: vi.fn(),
      downloadPodcastAudio: vi.fn(),
      cleanupPodcast: vi.fn(),
      handlePodcastClick: vi.fn(),
    };

    initUICallbacks({ cardHandlers, statusHandlers });
    resetHighlightState();
  });

  describe('createPodcastCard()', () => {
    it('creates a podcast card with header, info, status, and player', () => {
      const card = createPodcastCard(null, chatArea);

      expect(card.className).toBe('podcast-card');
      expect(card.querySelector('.podcast-card-header')).toBeTruthy();
      expect(card.querySelector('.podcast-info')).toBeTruthy();
      expect(card.querySelector('.podcast-status')).toBeTruthy();
      expect(card.querySelector('.podcast-player')).toBeTruthy();
    });

    it('includes quote preview when provided', () => {
      const card = createPodcastCard('Selected text', chatArea);
      expect(card.querySelector('.podcast-quote')).toBeTruthy();
      expect(card.querySelector('.podcast-quote')!.textContent).toContain('Selected text');
    });

    it('omits quote preview when null', () => {
      const card = createPodcastCard(null, chatArea);
      expect(card.querySelector('.podcast-quote')).toBeNull();
    });

    it('removes existing card before creating new one', () => {
      createPodcastCard(null, chatArea);
      createPodcastCard(null, chatArea);
      expect(chatArea.querySelectorAll('.podcast-card').length).toBe(1);
    });

    it('removes welcome message when creating card', () => {
      const welcome = document.createElement('div');
      welcome.className = 'welcome-msg';
      chatArea.appendChild(welcome);

      createPodcastCard(null, chatArea);
      expect(chatArea.querySelector('.welcome-msg')).toBeNull();
    });

    it('close button calls cardHandlers.onClose', () => {
      const card = createPodcastCard(null, chatArea);
      (card.querySelector('.podcast-card-close') as HTMLElement).click();
      expect(cardHandlers.onClose).toHaveBeenCalledWith(card);
    });

    it('play button calls cardHandlers.onPlayPause', () => {
      const card = createPodcastCard(null, chatArea);
      (card.querySelector('.podcast-play-btn') as HTMLElement).click();
      expect(cardHandlers.onPlayPause).toHaveBeenCalled();
    });
  });

  describe('renderTranscript()', () => {
    it('renders rounds with speaker labels', () => {
      const card = createPodcastCard(null, chatArea);
      renderTranscript(card, [
        { speaker: 'A', text: 'Hello', speakerLabel: 'Host' },
        { speaker: 'B', text: 'Hi there', speakerLabel: 'Guest' },
      ]);

      const rounds = card.querySelectorAll('.podcast-round');
      expect(rounds.length).toBe(2);
      expect(rounds[0].textContent).toContain('Hello');
    });

    it('hides rounds beyond 4 and shows toggle when >4 rounds', () => {
      const card = createPodcastCard(null, chatArea);
      const rounds = Array.from({ length: 6 }, (_, i) => ({
        speaker: 'A', text: `Round ${i}`, speakerLabel: 'Host',
      }));
      renderTranscript(card, rounds);

      const hiddenRounds = card.querySelectorAll('.podcast-round-hidden');
      expect(hiddenRounds.length).toBe(2); // rounds 4 and 5
      expect(card.querySelector('.podcast-transcript-toggle')).toBeTruthy();
      // Transcript container should be collapsed initially
      expect(card.querySelector('.podcast-transcript')!.classList.contains('podcast-transcript-collapsed')).toBe(true);
    });

    it('does not show toggle when ≤4 rounds', () => {
      const card = createPodcastCard(null, chatArea);
      renderTranscript(card, [
        { speaker: 'A', text: 'R1', speakerLabel: 'Host' },
      ]);
      expect(card.querySelector('.podcast-transcript-toggle')).toBeNull();
    });
  });

  describe('updateTranscriptHighlight()', () => {
    it('adds active class to the current round', () => {
      const card = createPodcastCard(null, chatArea);
      renderTranscript(card, [
        { speaker: 'A', text: 'R0', speakerLabel: 'H' },
        { speaker: 'B', text: 'R1', speakerLabel: 'G' },
      ]);

      updateTranscriptHighlight(1, card);

      const rounds = card.querySelectorAll('.podcast-round');
      expect(rounds[1].classList.contains('active')).toBe(true);
      expect(rounds[0].classList.contains('active')).toBe(false);
    });

    it('skips duplicate highlights (same index)', () => {
      const card = createPodcastCard(null, chatArea);
      renderTranscript(card, [
        { speaker: 'A', text: 'R0', speakerLabel: 'H' },
      ]);

      updateTranscriptHighlight(0, card);
      updateTranscriptHighlight(0, card);

      // Should only toggle once (no error from double-highlight)
      expect(card.querySelectorAll('.podcast-round.active').length).toBe(1);
    });

    it('ignores negative indices', () => {
      const card = createPodcastCard(null, chatArea);
      renderTranscript(card, [
        { speaker: 'A', text: 'R0', speakerLabel: 'H' },
      ]);

      updateTranscriptHighlight(-1, card);
      expect(card.querySelectorAll('.podcast-round.active').length).toBe(0);
    });
  });

  describe('updateCardStatus()', () => {
    it('generating_script: shows spinner', () => {
      const card = createPodcastCard(null, chatArea);
      updateCardStatus(card, 'generating_script');

      const status = card.querySelector('.podcast-status') as HTMLElement;
      expect(status.querySelector('.podcast-status-spinner')).toBeTruthy();
      expect(status.style.display).not.toBe('none');
    });

    it('generating_audio: shows spinner with audio message', () => {
      const card = createPodcastCard(null, chatArea);
      updateCardStatus(card, 'generating_audio');
      expect(card.querySelector('.podcast-status-spinner')).toBeTruthy();
    });

    it('playing: hides status, shows player, adds download button', () => {
      const card = createPodcastCard(null, chatArea);
      updateCardStatus(card, 'playing');

      const status = card.querySelector('.podcast-status') as HTMLElement;
      expect(status.style.display).toBe('none');
      expect(card.querySelector('.podcast-player')!.classList.contains('active')).toBe(true);
      expect(statusHandlers.addDownloadButton).toHaveBeenCalled();
    });

    it('done: shows replay and download buttons', () => {
      const card = createPodcastCard(null, chatArea);
      updateCardStatus(card, 'done');

      expect(card.querySelector('.podcast-replay-btn')).toBeTruthy();
      expect(card.querySelector('.podcast-download-btn')).toBeTruthy();

      // Click replay
      (card.querySelector('.podcast-replay-btn') as HTMLElement).click();
      expect(statusHandlers.replayAudio).toHaveBeenCalled();

      // Click download
      (card.querySelector('.podcast-download-btn') as HTMLElement).click();
      expect(statusHandlers.downloadPodcastAudio).toHaveBeenCalled();
    });

    it('error: shows error text and retry button', () => {
      const card = createPodcastCard(null, chatArea);
      updateCardStatus(card, 'error', 'Network failure');

      expect(card.querySelector('.podcast-status-error')).toBeTruthy();
      const retryBtn = card.querySelector('.podcast-retry-btn') as HTMLElement;
      expect(retryBtn).toBeTruthy();

      retryBtn.click();
      expect(statusHandlers.cleanupPodcast).toHaveBeenCalled();
      expect(statusHandlers.handlePodcastClick).toHaveBeenCalled();
    });
  });

  describe('restoreWelcomeIfNeeded()', () => {
    it('adds welcome message when chatArea is empty', () => {
      restoreWelcomeIfNeeded(chatArea);
      expect(chatArea.querySelector('.welcome-msg')).toBeTruthy();
    });

    it('does nothing when chatArea already has children', () => {
      const child = document.createElement('div');
      chatArea.appendChild(child);

      restoreWelcomeIfNeeded(chatArea);

      expect(chatArea.children.length).toBe(1); // only the original child
      expect(chatArea.querySelector('.welcome-msg')).toBeNull();
    });
  });

  describe('rebuildPodcastCard()', () => {
    it('restores title and description from now-playing metadata', () => {
      const np = {
        originTabId: 1,
        originTabTitle: '',
        title: 'My Title',
        description: 'A short summary',
        script: [],
        status: 'playing' as const,
      };
      const card = rebuildPodcastCard(np, chatArea);
      expect(card.querySelector('.podcast-info-title')!.textContent).toBe('My Title');
      expect(card.querySelector('.podcast-info-desc')!.textContent).toBe('A short summary');
      expect(card.querySelector('.podcast-info')!.classList.contains('active')).toBe(true);
    });

    it('does not set description when absent', () => {
      const np = {
        originTabId: 1,
        originTabTitle: '',
        title: 'T',
        script: [],
        status: 'playing' as const,
      };
      const card = rebuildPodcastCard(np, chatArea);
      // default placeholder text from createPodcastCard stays untouched
      expect(card.querySelector('.podcast-info-desc')!.textContent).toBe('');
    });

    it('re-renders the transcript rounds', () => {
      const np = {
        originTabId: 1,
        originTabTitle: '',
        title: 'T',
        script: [
          { speaker: 'A', text: 'hello', speakerLabel: 'A' },
          { speaker: 'B', text: 'world', speakerLabel: 'B' },
        ],
        status: 'playing' as const,
      };
      const card = rebuildPodcastCard(np, chatArea);
      expect(card.querySelectorAll('.podcast-round').length).toBe(2);
    });

    it('restores the done status (wires replay/download buttons)', () => {
      const np = {
        originTabId: 1,
        originTabTitle: '',
        title: 'T',
        script: [],
        status: 'done' as const,
      };
      const card = rebuildPodcastCard(np, chatArea);
      expect(card.querySelector('.podcast-replay-btn')).toBeTruthy();
      expect(card.querySelector('.podcast-download-btn')).toBeTruthy();
    });
  });
});
