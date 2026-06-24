import { t } from '../../shared/i18n.js';

/**
 * Lightweight, self-dismissing toast for brief user feedback (e.g. "正在提取页面内容…").
 *
 * Lives in the side panel only. Mounts a single floating element at the top
 * of the panel container; auto-removes after `duration` ms (default 1500).
 * Concurrent toasts stack vertically.
 */
const TOAST_CLASS = 'reader-toast';
const DEFAULT_DURATION = 1500;

export function showToast(message: string, duration: number = DEFAULT_DURATION): void {
  const container = document.querySelector('.container');
  const host = container ?? document.body;

  const el = document.createElement('div');
  el.className = TOAST_CLASS;
  el.textContent = message;
  host.appendChild(el);

  requestAnimationFrame(() => el.classList.add('reader-toast-visible'));
  window.setTimeout(() => {
    el.classList.remove('reader-toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 300);
  }, duration);
}

/** Convenience: the "extracting page content" toast used by ensurePageContent. */
export function showExtractingToast(): void {
  showToast(t('toast.extracting'));
}
