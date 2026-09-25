import * as state from '../state';

/** The two elements the quote preview bar touches. */
export interface QuotePreviewEls {
  quoteText: HTMLElement;
  quotePreview: HTMLElement;
}

const PREVIEW_CHARS = 50;

/**
 * Set (or clear, with '') the quoted text that rides along with the next
 * message, and show it in the preview bar above the input.
 */
export function updateQuotePreview(els: QuotePreviewEls, text: string): void {
  state.setSelectedText(text);
  if (text) {
    els.quoteText.textContent = text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) + '...' : text;
    els.quotePreview.classList.remove('hidden');
  } else {
    els.quoteText.textContent = '';
    els.quotePreview.classList.add('hidden');
  }
}
