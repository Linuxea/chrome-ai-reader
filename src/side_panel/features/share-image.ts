/**
 * F14 — share an AI answer as an image card.
 *
 * Wiring only: chatArea click delegation on the share button (added by
 * ui/tts-buttons to every finished answer, which covers live streams,
 * history restore and the ADD_TTS_BUTTON event path — R-06), data
 * collection from the bubble, then the preview modal (download / copy).
 *
 * Card construction and the E-01 truncation cascade live in ui/share-card;
 * rasterization in services/share-image.
 */

import { t } from '../../shared/i18n.js';
import { CSS } from '../../shared/css-selectors';
import { formatDateOnly } from '../../shared/format';
import * as state from '../state';
import { showToast } from '../ui/toast';
import { findUserWrapperBefore } from '../ui/dom-helpers';
import {
  buildFittedCard,
  rasterizeElement,
  buildShareFilename,
  downloadShareImage,
  copyShareImage,
} from '../services/share-image';

/** Fallback accent when --primary cannot be read (should not happen — themes always define it). */
const DEFAULT_ACCENT = '#3a7bd5';

export function initShareImage({ chatArea }: { chatArea: HTMLElement }): void {
  chatArea.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const btn = target?.closest?.(CSS.SHARE_IMAGE_BTN) as HTMLElement | null;
    if (!btn) return;
    void handleShareClick(btn);
  });
}

async function handleShareClick(btn: HTMLElement): Promise<void> {
  // §4.4: guard against re-entry while a card is being generated.
  if (btn.dataset.generating) return;
  const msgEl = btn.closest(CSS.MESSAGE_AI) as HTMLElement | null;
  if (!msgEl) return;

  // E-06: ignore clicks while the answer is still streaming. The design
  // referenced a `data-final` marker, which does not exist in this codebase;
  // the guarantee is structural (this button only ever attaches to finished
  // bubbles — finishAnswer / appendMessageFromHistory), and the live typing
  // indicator is the one in-flight DOM marker that can coexist with a
  // .message-ai bubble — checked here as defense in depth.
  if (msgEl.querySelector('.typing-indicator')) return;

  // E-07: markdown source first, rendered text as the legacy fallback —
  // the same source the copy button uses.
  const contentEl = msgEl.querySelector(CSS.THINKING_CONTENT);
  const markdown = msgEl.dataset.markdown || (contentEl ? contentEl.textContent : msgEl.textContent) || '';
  if (!markdown.trim()) return;

  // E-05: nearest preceding user bubble's display text. Quote and image
  // attachments live outside dataset.rawDisplay/rawText, so they never
  // enter the card (E-08).
  const group = findUserWrapperBefore(msgEl);
  const userEl = group?.querySelector(CSS.MESSAGE_USER) as HTMLElement | null;
  const question = (userEl?.dataset.rawDisplay || userEl?.dataset.rawText || '').trim() || undefined;

  const pageTitle = state.getPageTitle(); // E-04 handled in the card builder
  const accent =
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || DEFAULT_ACCENT;

  btn.dataset.generating = '1';
  const prevTitle = btn.title;
  btn.title = t('share.generating');
  try {
    const card = buildFittedCard({ question, pageTitle, date: formatDateOnly(new Date()), accent, markdown });
    const png = await rasterizeElement(card.el, card.width, card.height);
    openShareModal(png, buildShareFilename(pageTitle));
  } catch (err) {
    // E-02: rasterization failed — toast, modal never opens. Log it: this
    // path cannot run in jsdom, so real-machine failures are silent without it.
    console.error('[share-image] rasterization failed:', err);
    showToast(t('share.failed'), 2500);
  } finally {
    delete btn.dataset.generating;
    btn.title = prevTitle || t('action.shareImage');
  }
}

// --- Preview modal (singleton, built lazily; share.css styles it) ----------

interface ShareModal {
  root: HTMLElement;
  img: HTMLImageElement;
  copyBtn: HTMLButtonElement;
}

let _modal: ShareModal | null = null;
let _pngUrl = '';
let _current: { blob: Blob; filename: string } | null = null;

function buildModal(): ShareModal {
  const root = document.createElement('div');
  root.className = 'share-modal hidden';
  const dialog = document.createElement('div');
  dialog.className = 'share-modal-dialog';

  const header = document.createElement('div');
  header.className = 'share-modal-header';
  const title = document.createElement('span');
  title.className = 'share-modal-title';
  title.textContent = t('share.previewTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'share-modal-close';
  closeBtn.title = t('action.edit.cancel');
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  header.append(title, closeBtn);

  const preview = document.createElement('div');
  preview.className = 'share-modal-preview';
  const img = document.createElement('img');
  img.alt = t('share.previewTitle');
  preview.appendChild(img);

  const actions = document.createElement('div');
  actions.className = 'share-modal-actions';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'share-modal-btn';
  copyBtn.textContent = t('share.copyImage');
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'share-modal-btn primary';
  downloadBtn.textContent = t('share.download');
  actions.append(copyBtn, downloadBtn);

  dialog.append(header, preview, actions);
  root.appendChild(dialog);
  document.body.appendChild(root);

  // R-04: backdrop click and Escape close the modal.
  root.addEventListener('click', (e) => {
    if (e.target === root) closeShareModal();
  });
  closeBtn.addEventListener('click', closeShareModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !_modal?.root.classList.contains('hidden')) closeShareModal();
  });

  downloadBtn.addEventListener('click', () => {
    if (!_current) return;
    downloadShareImage(_current.blob, _current.filename);
  });

  copyBtn.addEventListener('click', () => {
    if (!_current) return;
    void copyShareImage(_current.blob)
      .then(() => {
        // Visible success feedback — the same 1.5s swap as the copy button.
        copyBtn.textContent = t('share.copied');
        setTimeout(() => {
          copyBtn.textContent = t('share.copyImage');
        }, 1500);
      })
      .catch(() => {
        // E-03: clipboard write refused / focus lost.
        showToast(t('share.failed'), 2500);
      });
  });

  return { root, img, copyBtn };
}

function openShareModal(blob: Blob, filename: string): void {
  if (!_modal) _modal = buildModal();
  _current = { blob, filename };
  if (_pngUrl) URL.revokeObjectURL(_pngUrl);
  _pngUrl = URL.createObjectURL(blob);
  _modal.img.src = _pngUrl;
  _modal.root.classList.remove('hidden');
}

function closeShareModal(): void {
  if (!_modal) return;
  _modal.root.classList.add('hidden');
  if (_pngUrl) {
    URL.revokeObjectURL(_pngUrl);
    _pngUrl = '';
  }
  _current = null;
}
