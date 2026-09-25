import { escapeHtml } from '../../shared/constants';
import { t } from '../../shared/i18n.js';
import { CSS } from '../../shared/css-selectors';
import { renderMarkdown } from './markdown';
import { linkifyCitations } from './citations';
import { emit, EVENTS } from '../events';
import * as autoScroll from './auto-scroll';
import type { ChatMessage, MessageContentPart } from '../../shared/types';

let _chatArea: HTMLElement;
let _actionBtns: NodeListOf<HTMLButtonElement>;
let _sendBtn: HTMLButtonElement;
let _userInput: HTMLTextAreaElement | null = null;
let _hasAttachments: () => boolean = () => false;
let _sendBtnDefaultHtml = '';

interface DOMHelperDeps {
  chatArea: HTMLElement;
  actionBtns: NodeListOf<HTMLButtonElement>;
  sendBtn: HTMLButtonElement;
  userInput?: HTMLTextAreaElement;
  /** Pending images count as content: an image-only message can be sent. */
  hasAttachments?: () => boolean;
}

export function initDOMHelpers({ chatArea, actionBtns, sendBtn, userInput, hasAttachments }: DOMHelperDeps): void {
  _chatArea = chatArea;
  _actionBtns = actionBtns;
  _sendBtn = sendBtn;
  _userInput = userInput ?? null;
  if (hasAttachments) _hasAttachments = hasAttachments;
  _sendBtnDefaultHtml = sendBtn.innerHTML;
  autoScroll.initAutoScroll(chatArea);
  updateSendButtonDim();
}

/** Options for batch rendering (tab switch / history reload). */
export interface AppendOptions {
  /** Append into this node instead of the chat area — lets callers build a DocumentFragment. */
  target?: HTMLElement | DocumentFragment;
  /** Skip the per-message scroll-to-bottom; batch callers scroll once at the end. */
  deferScroll?: boolean;
}

export function appendMessage(role: string, content: string, imageUris?: string[], options?: AppendOptions): HTMLDivElement {
  const parent = options?.target ?? _chatArea;
  const welcome = parent.querySelector(CSS.WELCOME_MSG);
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message message-${role}`;

  if (role === 'ai' && content) {
    div.innerHTML = renderMarkdown(content);
    linkifyCitations(div);
  } else if (content) {
    div.textContent = content;
  }

  if (imageUris && imageUris.length > 0 && role === 'user') {
    prependBubbleImages(div, imageUris);
  }

  if (role === 'user') {
    const wrapper = wrapUserMessage(div);
    addUserActions(wrapper, div);
    parent.appendChild(wrapper);
  } else {
    parent.appendChild(div);
  }

  if (!options?.deferScroll) scrollToBottom();
  return div;
}

export function appendMessageWithQuote(quoteStr: string, userText: string, imageUris?: string[], options?: AppendOptions): HTMLDivElement {
  const parent = options?.target ?? _chatArea;
  const welcome = parent.querySelector(CSS.WELCOME_MSG);
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'message message-user';

  let html = '';
  if (imageUris && imageUris.length > 0) {
    html += buildBubbleImagesHtml(imageUris);
  }
  html += `<blockquote class="quote-in-bubble">${escapeHtml(quoteStr)}</blockquote><span>${escapeHtml(userText)}</span>`;
  div.innerHTML = html;

  const wrapper = wrapUserMessage(div);
  addUserActions(wrapper, div);

  parent.appendChild(wrapper);
  if (!options?.deferScroll) scrollToBottom();
  return div;
}

/** What a user bubble shows and what retry / edit need to re-send it. */
export interface UserBubble {
  /** Text re-sent on retry (a quick action's prompt, or the typed text). */
  rawText: string;
  /** Text shown in the bubble. */
  displayText: string;
  /** Full quoted page text (shown truncated). */
  quote?: string;
  imageUris?: string[];
  /** History message id — retry / edit truncate history at exactly this entry. */
  id?: string;
  /** Other tabs attached as context (shown as a line under the text). */
  tabs?: { title: string }[];
}

const QUOTE_PREVIEW_CHARS = 50;

/**
 * The one way to render a user message — used for live sends and history
 * re-renders alike, so a restored bubble looks and behaves (retry / edit)
 * exactly like the original.
 */
export function appendUserMessage(bubble: UserBubble, options?: AppendOptions): HTMLDivElement {
  const { rawText, displayText, quote, imageUris, id, tabs } = bubble;
  let el: HTMLDivElement;
  if (quote) {
    const preview = quote.length > QUOTE_PREVIEW_CHARS ? quote.slice(0, QUOTE_PREVIEW_CHARS) + '...' : quote;
    el = appendMessageWithQuote(preview, displayText, imageUris, options);
    el.dataset.rawQuote = quote;
  } else {
    el = appendMessage('user', displayText, imageUris, options);
  }
  el.dataset.rawText = rawText;
  el.dataset.rawDisplay = displayText;
  if (id) el.dataset.msgId = id;
  if (tabs?.length) {
    const line = document.createElement('div');
    line.className = 'bubble-tabs';
    line.textContent = tabs.map((t) => `📄 ${t.title}`).join('  ');
    el.appendChild(line);
  }
  return el;
}

export function buildBubbleImagesHtml(imageUris: string[]): string {
  return '<div class="bubble-images">' +
    imageUris.map(uri => `<img src="${uri.replace(/"/g, '&quot;')}" class="bubble-img-thumb">`).join('') +
    '</div>';
}

export function prependBubbleImages(div: HTMLDivElement, imageUris: string[]): void {
  const container = document.createElement('div');
  container.innerHTML = buildBubbleImagesHtml(imageUris);
  if (container.firstElementChild) {
    div.insertBefore(container.firstElementChild, div.firstChild);
  }
}

export function wrapUserMessage(msgEl: HTMLDivElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'user-msg-group';
  wrapper.appendChild(msgEl);
  return wrapper;
}

function addUserActions(wrapper: HTMLDivElement, msgEl: HTMLDivElement): void {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'msg-action-btn';
  editBtn.title = t('action.edit');
  editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
  editBtn.addEventListener('click', () => {
    openInlineEditor(wrapper, msgEl);
  });

  const retryBtn = document.createElement('button');
  retryBtn.className = 'msg-action-btn';
  retryBtn.title = t('action.retry');
  retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
  retryBtn.addEventListener('click', () => {
    const rawText = msgEl.dataset.rawText || '';
    const rawQuote = msgEl.dataset.rawQuote || '';
    const rawDisplay = msgEl.dataset.rawDisplay || rawText;
    emit(EVENTS.RETRY, { wrapper, rawText, rawDisplay, rawQuote, msgId: msgEl.dataset.msgId });
  });

  actions.appendChild(editBtn);
  actions.appendChild(retryBtn);
  wrapper.appendChild(actions);
}

/**
 * Replace a user bubble with an inline editor (textarea + Save/Cancel).
 * Preserves any existing image thumbnails; the quote (if any) is kept as-is
 * and re-sent unchanged. Cancel restores the original bubble via a captured
 * innerHTML snapshot — no event rebinding needed because dataset.* (read by
 * the retry button at click time) survive innerHTML swaps.
 */
function openInlineEditor(wrapper: HTMLDivElement, msgEl: HTMLDivElement): void {
  const rawDisplay = msgEl.dataset.rawDisplay || msgEl.textContent?.trim() || '';
  const snapshot = msgEl.innerHTML;

  const actions = wrapper.querySelector<HTMLElement>('.msg-actions');
  if (actions) actions.style.display = 'none';

  const imgs = Array.from(msgEl.querySelectorAll<HTMLImageElement>('.bubble-images img'));
  const imageHtml = imgs.length > 0
    ? '<div class="bubble-images">' + imgs.map(i => `<img src="${i.src.replace(/"/g, '&quot;')}" class="bubble-img-thumb">`).join('') + '</div>'
    : '';

  msgEl.innerHTML =
    imageHtml +
    `<textarea class="msg-edit-textarea" rows="1"></textarea>` +
    `<div class="msg-edit-buttons">` +
      `<button type="button" class="msg-edit-btn msg-edit-cancel">${t('action.edit.cancel')}</button>` +
      `<button type="button" class="msg-edit-btn msg-edit-save">${t('action.edit.save')}</button>` +
    `</div>`;

  const ta = msgEl.querySelector<HTMLTextAreaElement>('.msg-edit-textarea');
  if (!ta) return;
  ta.value = rawDisplay;
  autoGrow(ta);
  ta.addEventListener('input', () => autoGrow(ta));
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const restore = (): void => {
    msgEl.innerHTML = snapshot;
    if (actions) actions.style.display = '';
  };

  const save = (): void => {
    const edited = ta.value.trim();
    // Clearing the text is fine when the message still carries images.
    if (!edited && imgs.length === 0) return;
    emit(EVENTS.EDIT, {
      wrapper,
      originalRawText: msgEl.dataset.rawText || '',
      editedText: edited,
      rawQuote: msgEl.dataset.rawQuote || undefined,
      msgId: msgEl.dataset.msgId,
    });
  };

  const cancelBtn = msgEl.querySelector<HTMLButtonElement>('.msg-edit-cancel');
  const saveBtn = msgEl.querySelector<HTMLButtonElement>('.msg-edit-save');
  cancelBtn?.addEventListener('click', restore);
  saveBtn?.addEventListener('click', save);
  // Same keys as the main input: Enter saves, Shift+Enter is a newline,
  // Escape cancels. Enter during IME composition picks a candidate instead.
  ta.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      restore();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  });
}

function autoGrow(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

export function removeLastMessage(): void {
  const messages = _chatArea.querySelectorAll(CSS.MESSAGE);
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const group = last.closest('.user-msg-group');
    if (group) {
      group.remove();
    } else {
      last.remove();
    }
  }
}

// --- Error bubble actions ----------------------------------------------------
// Error bubbles are actionable: retry re-sends the failed user message,
// open-settings jumps to the options page for config errors.

export interface ErrorMessageAction {
  label: string;
  onClick: () => void;
}

function buildErrorActionsRow(actions: ErrorMessageAction[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'error-actions';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'error-action-btn';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    row.appendChild(btn);
  }
  return row;
}

/** A quiet centered status line element (not yet attached). */
export function createNoteElement(text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'message message-note';
  div.textContent = text;
  return div;
}

/** A quiet centered status line (e.g. "generation stopped"). */
export function appendNoteMessage(text: string): HTMLDivElement {
  const div = createNoteElement(text);
  _chatArea.appendChild(div);
  smartScrollToBottom();
  return div;
}

/** Create a new error bubble with an action row (retry / settings / …). */
export function appendErrorMessage(text: string, actions: ErrorMessageAction[] = []): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'message message-error';
  const span = document.createElement('span');
  span.className = 'error-text';
  span.textContent = text;
  div.appendChild(span);
  if (actions.length > 0) div.appendChild(buildErrorActionsRow(actions));
  _chatArea.appendChild(div);
  scrollToBottom();
  return div;
}

/** Attach an action row to an existing error bubble (the streaming path reuses the AI bubble). */
export function addErrorMessageActions(msgEl: HTMLElement, actions: ErrorMessageAction[]): void {
  if (actions.length === 0) return;
  msgEl.appendChild(buildErrorActionsRow(actions));
}

/** Re-send the user message inside `wrapper` via the RETRY event. */
export function emitRetryFromWrapper(wrapper: HTMLElement): void {
  const userEl = wrapper.querySelector('.message-user') as HTMLElement | null;
  emit(EVENTS.RETRY, {
    wrapper,
    rawText: userEl?.dataset.rawText || '',
    rawDisplay: userEl?.dataset.rawDisplay || userEl?.textContent || '',
    rawQuote: userEl?.dataset.rawQuote || '',
    msgId: userEl?.dataset.msgId,
  });
}

/** Nearest user-message group at or before `msgEl` — the retry target for an error bubble. */
export function findUserWrapperBefore(msgEl: HTMLElement): HTMLElement | null {
  let el = msgEl.previousElementSibling;
  while (el) {
    if (el.classList.contains('user-msg-group')) return el as HTMLElement;
    el = el.previousElementSibling;
  }
  return null;
}

export function updateLastMessage(role: string, content: string): void {
  const messages = _chatArea.querySelectorAll(CSS.MESSAGE);
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    last.className = `message message-${role}`;
    if (role === 'ai') {
      last.innerHTML = renderMarkdown(content);
    } else {
      last.textContent = content;
    }
  }
}

export function addTypingIndicator(msgEl: HTMLElement): HTMLDivElement {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  msgEl.appendChild(indicator);
  return indicator;
}

export function removeTypingIndicator(indicator: HTMLElement | null): void {
  if (indicator && indicator.parentNode) {
    indicator.remove();
  }
}

export function scrollToBottom(): void {
  autoScroll.scrollToBottom();
}

export function smartScrollToBottom(): void {
  autoScroll.smartScrollToBottom();
}

const STOP_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;

function setSendButtonMode(mode: 'send' | 'stop'): void {
  if (mode === 'stop') {
    if (_sendBtn.classList.contains('is-stop')) return;
    _sendBtn.classList.add('is-stop');
    _sendBtn.classList.remove('send-dim');
    _sendBtn.title = t('action.stop');
    _sendBtn.innerHTML = STOP_ICON;
  } else if (_sendBtn.classList.contains('is-stop')) {
    _sendBtn.classList.remove('is-stop');
    _sendBtn.title = t('sidebar.send');
    _sendBtn.innerHTML = _sendBtnDefaultHtml;
    updateSendButtonDim();
  }
}

/** Dim the send button while there is nothing to send — no text and no pending images. */
export function updateSendButtonDim(): void {
  if (!_sendBtn || _sendBtn.classList.contains('is-stop')) return;
  const noText = !_userInput || _userInput.value.trim() === '';
  _sendBtn.classList.toggle('send-dim', noText && !_hasAttachments());
}

export function setButtonsDisabled(disabled: boolean): void {
  _actionBtns.forEach(btn => {
    const action = btn.dataset.action;
    if (action === 'podcast') return;
    btn.disabled = disabled;
  });
  /* The send button morphs into a stop control during generation instead of
     disabling — a long generation needs an abort affordance. */
  setSendButtonMode(disabled ? 'stop' : 'send');
}

/**
 * Render a chat message from `conversationHistory` (memory or reloaded from
 * storage) into the chat area. User messages go through appendUserMessage so
 * retry / edit keep working after a tab switch, reopen or history load. Handles both string content (plain text) and
 * array content (multimodal — extracts image_url thumbnails). On reload,
 * `hadImages: true` with string content means images were stripped at
 * persistence time → show an "image lost" hint.
 */
export function appendMessageFromHistory(msg: ChatMessage, options?: AppendOptions): HTMLDivElement {
  const imageUris = extractImageUrisFromContent(msg);
  const text = extractTextFromContent(msg);
  let div: HTMLDivElement;
  if (msg.role === 'user') {
    // `meta` holds what the user entered; legacy entries without it fall back
    // to the assembled content (retry then re-sends that content verbatim).
    div = appendUserMessage(
      msg.meta
        ? { rawText: msg.meta.rawText, displayText: msg.meta.displayText, quote: msg.meta.quote, imageUris, id: msg.id, tabs: msg.meta.tabs }
        : { rawText: text, displayText: text, imageUris, id: msg.id },
      options,
    );
  } else {
    div = appendMessage(msg.role === 'assistant' ? 'ai' : msg.role, text, imageUris, options);
    if (msg.role === 'assistant') div.dataset.markdown = text; // copy button source
  }

  // Restored messages get their action buttons back (copy/TTS/download) via
  // the ADD_TTS_BUTTON event — ui/** must not import services directly.
  if (msg.role === 'assistant') {
    emit(EVENTS.ADD_TTS_BUTTON, { msgEl: div });
  }

  if (msg.hadImages && imageUris.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'image-lost-hint';
    hint.textContent = t('error.imageLostAfterReload');
    div.insertBefore(hint, div.firstChild);
  }
  return div;
}

export function extractImageUrisFromContent(msg: ChatMessage): string[] {
  if (typeof msg.content === 'string') return [];
  return msg.content
    .filter((p): p is Extract<MessageContentPart, { type: 'image_url' }> => p.type === 'image_url')
    .map(p => p.image_url.url);
}

function extractTextFromContent(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((p): p is Extract<MessageContentPart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}
