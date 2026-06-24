/**
 * Deep annotation side-panel feature — owns the「深度批阅」button, its state
 * machine, and relays messages to/from the content module.
 *
 * State machine: idle → annotating → done → (click) → idle
 *                                   ↘ error
 *
 * Messages from content (via chrome.runtime.onMessage):
 *   annotationProgress {done, total} — update button label
 *   annotationDone {count}           — mark done, show count
 *   annotationFailed {chunkIndex}    — mark error
 *   annotationFollowUp {quote, comment} — quote the AI-annotated source
 *     sentence (shows the same quote-preview bar as the normal quote feature)
 *     and fill the AI comment into the input for follow-up chat.
 */
import { t } from '../../shared/i18n.js';
import { updateQuotePreview, type UIElements } from '../ui/global-events.js';

type AnnotationState = 'idle' | 'annotating' | 'done' | 'error';

const ICON_PEN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const ICON_CLOCK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const ICON_CHECK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_ALERT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

let _button: HTMLButtonElement | null = null;
let _userInput: HTMLTextAreaElement | null = null;
let _uiEls: Pick<UIElements, 'quoteText' | 'quotePreview'> | null = null;
let _state: AnnotationState = 'idle';

export interface AnnotationDeps {
  button: HTMLButtonElement;
  userInput?: HTMLTextAreaElement;
  /** Quote-preview elements, so follow-up can reuse the standard quote UI. */
  quoteText?: HTMLElement;
  quotePreview?: HTMLElement;
}

export function initAnnotation(deps: AnnotationDeps): void {
  _button = deps.button;
  _userInput = deps.userInput ?? null;
  if (deps.quoteText && deps.quotePreview) {
    _uiEls = { quoteText: deps.quoteText, quotePreview: deps.quotePreview };
  }

  _button.addEventListener('click', onButtonClick);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  renderButton();
}

async function onButtonClick(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId == null) return;

  if (_state === 'done' || _state === 'error') {
    // Second click clears annotations and returns to idle.
    chrome.tabs.sendMessage(tabId, { action: 'clearAnnotation' }, () => undefined);
    setState('idle');
    return;
  }
  if (_state === 'idle') {
    chrome.tabs.sendMessage(tabId, { action: 'startAnnotation' }, () => undefined);
    setState('annotating');
  }
}

function onRuntimeMessage(msg: Record<string, unknown>): void {
  const action = msg.action as string;
  if (action === 'annotationProgress') {
    setState('annotating');
    _button!.innerHTML = `<span class="action-icon">${ICON_CLOCK}</span><span>${t('annotation.buttonActive', { done: msg.done, total: msg.total })}</span>`;
  } else if (action === 'annotationDone') {
    setState('done');
    _button!.innerHTML = `<span class="action-icon">${ICON_CHECK}</span><span>${t('annotation.buttonDone', { n: msg.count })}</span>`;
  } else if (action === 'annotationFailed') {
    setState('error');
    _button!.innerHTML = `<span class="action-icon">${ICON_ALERT}</span><span>${t('annotation.error')}</span>`;
  } else if (action === 'annotationFollowUp') {
    const quote = (msg.quote as string) || '';
    const comment = (msg.comment as string) || '';
    // Reuse the standard quote UI: show the annotated source sentence as the
    // quote preview (and set it as selectedText so the next send attaches it),
    // then put the AI comment into the input for the user to follow up.
    if (_uiEls) updateQuotePreview(_uiEls, quote);
    if (_userInput) _userInput.value = _userInput.value ? `${_userInput.value}\n${comment}` : comment;
  }
}

function setState(next: AnnotationState): void {
  _state = next;
  renderButton();
}

function renderButton(): void {
  if (!_button) return;
  if (_state === 'idle') {
    _button.innerHTML = `<span class="action-icon">${ICON_PEN}</span><span>${t('annotation.button')}</span>`;
  }
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

// --- Test accessors (only used by unit tests) ---
export function __getAnnotationState(): AnnotationState { return _state; }
