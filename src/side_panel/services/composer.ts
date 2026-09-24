/**
 * Composer — the single owner of "what the user is about to send".
 *
 * A draft is text (the input box) + attachments (preview-bar images). The
 * quote lives in state.selectedText and is attached by sendToAI for every
 * send, so it is not handled here.
 *
 * Every entry point that sends something to the model (Enter/send button,
 * quick actions, quick commands, podcast) goes through this module instead of
 * reading the input box / preview bar piecemeal — previously each entry
 * re-implemented that assembly and they drifted (quick commands left images
 * stranded in the preview bar, podcast cleared them unused, …).
 *
 * Every programmatic change to the input box also goes through here
 * (setDraftText/appendDraftText/clearDraftText) so auto-resize, the send
 * button dim state and the command popup stay in sync with the value.
 */
import { collectImageDataUris, clearImagePreviews, hasPendingImages } from './images.js';

let _userInput: HTMLTextAreaElement | null = null;

export function initComposer({ userInput }: { userInput: HTMLTextAreaElement }): void {
  _userInput = userInput;
}

// --- Draft text --------------------------------------------------------------

export function getDraftText(): string {
  return _userInput?.value.trim() ?? '';
}

/** Replace the input value, firing `input` so resize/dim/popup listeners run. */
export function setDraftText(text: string, { focus = false }: { focus?: boolean } = {}): void {
  if (!_userInput) return;
  _userInput.value = text;
  _userInput.dispatchEvent(new Event('input', { bubbles: true }));
  if (focus) {
    _userInput.focus();
    _userInput.setSelectionRange(text.length, text.length);
  }
}

/** Put `text` into the input without destroying an existing draft (appends on a new line). */
export function appendDraftText(text: string, opts?: { focus?: boolean }): void {
  const current = _userInput?.value ?? '';
  setDraftText(current.trim() ? `${current}\n${text}` : text, opts);
}

export function clearDraftText(): void {
  setDraftText('');
}

// --- Attachments ---------------------------------------------------------------

export interface Attachments {
  /** Image data URIs, sent to the model as image_url parts. */
  imageUris: string[];
}

/** True when images are waiting to be sent (an image-only message is valid). */
export function hasAttachments(): boolean {
  return hasPendingImages();
}

/** Take the pending attachments out of the composer (clearing the preview bar). */
export function consumeAttachments(): Attachments {
  const attachments: Attachments = { imageUris: collectImageDataUris() };
  clearImagePreviews();
  return attachments;
}
