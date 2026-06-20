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
    _button!.innerHTML = `<span class="action-icon">⏳</span><span>${t('annotation.buttonActive', { done: msg.done, total: msg.total })}</span>`;
  } else if (action === 'annotationDone') {
    setState('done');
    _button!.innerHTML = `<span class="action-icon">✓</span><span>${t('annotation.buttonDone', { n: msg.count })}</span>`;
  } else if (action === 'annotationFailed') {
    setState('error');
    _button!.innerHTML = `<span class="action-icon">⚠️</span><span>${t('annotation.error')}</span>`;
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
    _button.innerHTML = `<span class="action-icon">🩺</span><span>${t('annotation.button')}</span>`;
  }
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

// --- Test accessors (only used by unit tests) ---
export function __getAnnotationState(): AnnotationState { return _state; }
