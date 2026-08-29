import { t } from '../../shared/i18n.js';
import { CSS } from '../../shared/css-selectors';

interface TTSButtonDeps {
  onToggleTTS: (msgEl: HTMLElement) => void;
  onDownload: (msgEl: HTMLElement) => void;
}

/**
 * Create copy, TTS, and download buttons for an AI message.
 * Pure UI construction — delegates behavior to callbacks.
 */
export function createTTSButtons(msgEl: HTMLElement, deps: TTSButtonDeps): void {
  // Remove existing buttons
  const prevTts = msgEl.querySelector(CSS.TTS_BTN);
  if (prevTts) prevTts.remove();
  const prevDownload = msgEl.querySelector(CSS.TTS_DOWNLOAD_BTN);
  if (prevDownload) prevDownload.remove();
  const prevCopy = msgEl.querySelector(CSS.AI_ACTION_BTN);
  if (prevCopy) prevCopy.remove();

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = CSS.AI_ACTION_BTN.replace('.', '');
  copyBtn.title = t('action.copy');
  const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  copyBtn.innerHTML = copyIcon;

  copyBtn.addEventListener('click', () => {
    const contentEl = msgEl.querySelector(CSS.THINKING_CONTENT);
    const text = contentEl ? contentEl.textContent : msgEl.textContent;
    if (text && text.trim()) {
      navigator.clipboard.writeText(text.trim()).then(() => {
        // Visible feedback: icon swaps to a check for 1.5s (a title-only swap
        // was effectively invisible).
        copyBtn.innerHTML = checkIcon;
        copyBtn.title = t('action.copied');
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = copyIcon;
          copyBtn.title = t('action.copy');
          copyBtn.classList.remove('copied');
        }, 1500);
      }).catch(() => {});
    }
  });
  msgEl.appendChild(copyBtn);

  // TTS button
  const btn = document.createElement('button');
  btn.className = CSS.TTS_BTN.replace('.', '');
  btn.title = t('action.tts');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
  btn.addEventListener('click', () => deps.onToggleTTS(msgEl));
  msgEl.appendChild(btn);

  // Download button
  const dlBtn = document.createElement('button');
  dlBtn.className = CSS.TTS_DOWNLOAD_BTN.replace('.', '');
  dlBtn.title = t('action.ttsDownload');
  dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
  dlBtn.addEventListener('click', () => deps.onDownload(msgEl));
  msgEl.appendChild(dlBtn);
}
