/**
 * Composer — the single owner of "what the user is about to send".
 *
 * A draft is text (the input box) + attachments (preview-bar images and their
 * OCR results). The quote lives in state.selectedText and is attached by
 * sendToAI for every send, so it is not handled here.
 *
 * Every entry point that sends something to the model (Enter/send button,
 * quick actions, quick commands, podcast) goes through this module instead of
 * reading the input box / preview bar / OCR state piecemeal — previously each
 * entry re-implemented that assembly and they drifted (quick commands left
 * images stranded in the preview bar, podcast cleared them unused, …).
 *
 * Every programmatic change to the input box also goes through here
 * (setDraftText/appendDraftText/clearDraftText) so auto-resize, the send
 * button dim state and the command popup stay in sync with the value.
 */
import { t } from '../../shared/i18n.js';
import { getSync } from '../../platform/storage';
import {
  validateImageState, buildOcrContext, collectImageDataUris,
  clearImagePreviews, hasImagesWithoutOcr,
} from './ocr.js';

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
  /** OCR text block (vision off). Empty when vision is on or nothing was recognized. */
  ocrContext: string;
  /** Image data URIs (vision on). Empty when vision is off. */
  imageUris: string[];
}

/**
 * Returns an error message if the pending attachments cannot be sent right
 * now (OCR still running / failed, or images that need a vision model while
 * vision is off), otherwise null.
 */
export async function validateAttachments(): Promise<string | null> {
  const imageError = validateImageState();
  if (imageError) return imageError;
  const visionOn = await isVisionOn();
  if (!visionOn && hasImagesWithoutOcr()) return t('error.imageNeedsVision');
  return null;
}

/**
 * Take the pending attachments out of the composer (clearing the preview bar)
 * in the form the current model mode expects: image URIs when vision is on,
 * OCR text when it is off. Call validateAttachments() first.
 */
export async function consumeAttachments(): Promise<Attachments> {
  const visionOn = await isVisionOn();
  const attachments: Attachments = visionOn
    ? { ocrContext: '', imageUris: collectImageDataUris() }
    : { ocrContext: buildOcrContext(), imageUris: [] };
  clearImagePreviews();
  return attachments;
}

async function isVisionOn(): Promise<boolean> {
  const { visionEnabled } = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
  return visionEnabled === true;
}
