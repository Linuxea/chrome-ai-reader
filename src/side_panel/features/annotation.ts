/**
 * Deep annotation side-panel feature — owns the「深度批阅」button, its state
 * machine, and relays messages to/from the content module.
 *
 * State machine (tracked PER TAB — annotations live in a page, so the button
 * shows the state of the tab currently displayed):
 *   idle → annotating → done → (click) → idle
 *                     ↘ error → (click) → idle
 *
 * Messages from content (via chrome.runtime.onMessage, attributed to the
 * sending tab through `sender.tab.id`):
 *   annotationProgress {done, total} — update button label
 *   annotationDone {count, failed?}  — mark done, show count (+ partial-fail note)
 *   annotationFailed {error}         — terminal: every chunk failed, surface error
 *   annotationFollowUp {quote, comment} — quote the AI-annotated source
 *     sentence (shows the same quote-preview bar as the normal quote feature)
 *     and fill the AI comment into the input for follow-up chat.
 */
import { t } from '../../shared/i18n.js';
import { sendToContentScript } from '../../platform/messaging';
import * as state from '../state';
import { updateQuotePreview, type QuotePreviewEls } from '../ui/quote-preview';
import { appendDraftText } from '../services/composer';

type AnnotationState = 'idle' | 'annotating' | 'done' | 'error';

type TabAnnotation =
  | { kind: 'idle' }
  | { kind: 'annotating'; done: number; total: number }
  | { kind: 'done'; count: number; failed: number }
  | { kind: 'error'; error: string };

const ICON_PEN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const ICON_CLOCK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const ICON_CHECK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_ALERT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

const IDLE: TabAnnotation = { kind: 'idle' };

let _button: HTMLButtonElement | null = null;
let _uiEls: QuotePreviewEls | null = null;
const _byTab = new Map<number, TabAnnotation>();

export interface AnnotationDeps {
  button: HTMLButtonElement;
  /** Kept for API compatibility — follow-up text goes through the composer. */
  userInput?: HTMLTextAreaElement;
  /** Quote-preview elements, so follow-up can reuse the standard quote UI. */
  quoteText?: HTMLElement;
  quotePreview?: HTMLElement;
}

export function initAnnotation(deps: AnnotationDeps): void {
  _button = deps.button;
  _byTab.clear();
  if (deps.quoteText && deps.quotePreview) {
    _uiEls = { quoteText: deps.quoteText, quotePreview: deps.quotePreview };
  }

  _button.addEventListener('click', onButtonClick);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  // Show the state of whichever tab the panel now displays.
  state.subscribe('tabSwitched', render);
  // A page (re)load wipes the page's annotations — the tab is idle again.
  chrome.tabs.onUpdated?.addListener((tabId: number, changeInfo: { status?: string }) => {
    if (changeInfo.status === 'loading' && _byTab.has(tabId)) setTab(tabId, IDLE);
  });
  chrome.tabs.onRemoved?.addListener((tabId: number) => { _byTab.delete(tabId); });
  render();
}

function activeTabId(): number | null {
  return state.getActiveTabId();
}

function current(): TabAnnotation {
  const tabId = activeTabId();
  return (tabId != null && _byTab.get(tabId)) || IDLE;
}

function setTab(tabId: number, next: TabAnnotation): void {
  if (next.kind === 'idle') _byTab.delete(tabId);
  else _byTab.set(tabId, next);
  if (tabId === activeTabId()) render();
}

async function onButtonClick(): Promise<void> {
  const tabId = activeTabId();
  if (tabId == null) return;
  const cur = current();

  if (cur.kind === 'done' || cur.kind === 'error') {
    // Second click clears annotations and returns to idle.
    setTab(tabId, IDLE);
    sendToContentScript(tabId, { action: 'clearAnnotation' }).catch(() => { /* page gone / unsupported */ });
    return;
  }
  if (cur.kind === 'idle') {
    setTab(tabId, { kind: 'annotating', done: 0, total: 0 });
    try {
      await sendToContentScript(tabId, { action: 'startAnnotation' });
    } catch {
      // No content script possible here (chrome://, Web Store, …): don't sit
      // in "annotating" forever.
      setTab(tabId, { kind: 'error', error: t('error.pageUnsupported') });
    }
  }
}

function onRuntimeMessage(msg: Record<string, unknown>, sender?: chrome.runtime.MessageSender): void {
  const action = msg.action as string;
  if (!action?.startsWith('annotation')) return;
  const tabId = sender?.tab?.id;
  if (tabId == null) return;

  if (action === 'annotationProgress') {
    setTab(tabId, { kind: 'annotating', done: Number(msg.done) || 0, total: Number(msg.total) || 0 });
  } else if (action === 'annotationDone') {
    const failed = (msg.failed as number) || 0;
    if (failed > 0) console.warn(`[annotation] ${failed} chunk(s) failed during annotation`);
    setTab(tabId, { kind: 'done', count: Number(msg.count) || 0, failed });
  } else if (action === 'annotationFailed') {
    const error = (msg.error as string) || '';
    if (error) console.error('[annotation] failed:', error);
    setTab(tabId, { kind: 'error', error });
  } else if (action === 'annotationFollowUp') {
    // Only the page the user is looking at can start a follow-up here.
    if (tabId !== activeTabId()) return;
    const quote = (msg.quote as string) || '';
    const comment = (msg.comment as string) || '';
    // Reuse the standard quote UI: show the annotated source sentence as the
    // quote preview (and set it as selectedText so the next send attaches it),
    // then put the AI comment into the input for the user to follow up.
    if (_uiEls) updateQuotePreview(_uiEls, quote);
    if (comment) appendDraftText(comment, { focus: true });
  }
}

function render(): void {
  if (!_button) return;
  const cur = current();
  _button.title = '';
  if (cur.kind === 'idle') {
    _button.innerHTML = `<span class="action-icon">${ICON_PEN}</span><span>${t('annotation.button')}</span>`;
  } else if (cur.kind === 'annotating') {
    _button.innerHTML = `<span class="action-icon">${ICON_CLOCK}</span><span>${t('annotation.buttonActive', { done: cur.done, total: cur.total })}</span>`;
  } else if (cur.kind === 'done') {
    _button.innerHTML = `<span class="action-icon">${ICON_CHECK}</span><span>${t('annotation.buttonDone', { n: cur.count })}</span>`;
    if (cur.failed > 0) _button.title = t('annotation.donePartialTitle', { failed: cur.failed });
  } else {
    _button.innerHTML = `<span class="action-icon">${ICON_ALERT}</span><span>${t('annotation.error')}</span>`;
    if (cur.error) _button.title = t('annotation.errorTitle', { error: cur.error });
  }
}

// --- Test accessors (only used by unit tests) ---
export function __getAnnotationState(): AnnotationState {
  return current().kind;
}
