/**
 * Tests for side_panel/ui/tts-buttons.ts — copy/TTS/download button construction.
 *
 * Pure UI module: creates 3 buttons, delegates behavior via callbacks.
 * Tests verify DOM structure, callback dispatch, and copy logic.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
vi.mock('../../../src/shared/css-selectors.js', () => ({
  CSS: {
    TTS_BTN: '.tts-btn',
    TTS_DOWNLOAD_BTN: '.tts-download-btn',
    AI_ACTION_BTN: '.ai-action-btn',
    THINKING_CONTENT: '.thinking-response-content',
    TTS_PLAYING: '.tts-playing',
    TTS_LOADING: '.tts-loading',
  },
}));

import { createTTSButtons } from '../../../src/side_panel/ui/tts-buttons';

describe('ui/tts-buttons', () => {
  let msgEl: HTMLElement;
  let onToggleTTS: ReturnType<typeof vi.fn>;
  let onDownload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    msgEl = document.createElement('div');
    document.body.appendChild(msgEl);
    onToggleTTS = vi.fn();
    onDownload = vi.fn();
  });

  it('creates copy, TTS, and download buttons', () => {
    createTTSButtons(msgEl, { onToggleTTS, onDownload });
    expect(msgEl.querySelector('.ai-action-btn')).toBeTruthy();
    expect(msgEl.querySelector('.tts-btn')).toBeTruthy();
    expect(msgEl.querySelector('.tts-download-btn')).toBeTruthy();
  });

  it('removes existing buttons before adding new ones', () => {
    // Add an old button
    const old = document.createElement('button');
    old.className = 'tts-btn';
    msgEl.appendChild(old);

    createTTSButtons(msgEl, { onToggleTTS, onDownload });

    const buttons = msgEl.querySelectorAll('.tts-btn');
    expect(buttons.length).toBe(1); // only the new one
  });

  it('TTS button click calls onToggleTTS with msgEl', () => {
    createTTSButtons(msgEl, { onToggleTTS, onDownload });
    const btn = msgEl.querySelector('.tts-btn') as HTMLButtonElement;
    btn.click();
    expect(onToggleTTS).toHaveBeenCalledWith(msgEl);
  });

  it('download button click calls onDownload with msgEl', () => {
    createTTSButtons(msgEl, { onToggleTTS, onDownload });
    const btn = msgEl.querySelector('.tts-download-btn') as HTMLButtonElement;
    btn.click();
    expect(onDownload).toHaveBeenCalledWith(msgEl);
  });

  it('copy button reads textContent when no thinking-response-content', () => {
    msgEl.textContent = 'Copy this text';
    createTTSButtons(msgEl, { onToggleTTS, onDownload });

    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const copyBtn = msgEl.querySelector('.ai-action-btn') as HTMLButtonElement;
    copyBtn.click();

    expect(writeText).toHaveBeenCalledWith('Copy this text');
  });

  it('copy button reads from .thinking-response-content when present', () => {
    const content = document.createElement('div');
    content.className = 'thinking-response-content';
    content.textContent = 'Inner content';
    msgEl.appendChild(content);
    msgEl.appendChild(document.createTextNode('Outer content'));

    createTTSButtons(msgEl, { onToggleTTS, onDownload });
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const copyBtn = msgEl.querySelector('.ai-action-btn') as HTMLButtonElement;
    copyBtn.click();

    expect(writeText).toHaveBeenCalledWith('Inner content');
  });

  it('does not copy empty text', () => {
    msgEl.textContent = '   ';
    createTTSButtons(msgEl, { onToggleTTS, onDownload });
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const copyBtn = msgEl.querySelector('.ai-action-btn') as HTMLButtonElement;
    copyBtn.click();

    expect(writeText).not.toHaveBeenCalled();
  });
});
