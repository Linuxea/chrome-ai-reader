import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock i18n before importing modules that depend on it
vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: { RETRY: 'retry', EDIT: 'edit' },
}));

import {
  initDOMHelpers,
  appendMessage,
  appendMessageWithQuote,
  appendMessageFromHistory,
  buildBubbleImagesHtml,
  prependBubbleImages,
  wrapUserMessage,
  removeLastMessage,
  updateLastMessage,
  addTypingIndicator,
  removeTypingIndicator,
  scrollToBottom,
  smartScrollToBottom,
  setButtonsDisabled,
} from '../../../src/side_panel/ui/dom-helpers.js';
import { emit, EVENTS } from '../../../src/side_panel/events.js';

function createChatArea() {
  const el = document.createElement('div');
  // jsdom doesn't implement scrollTop/scrollHeight setters, so mock them
  let _scrollTop = 0;
  let _scrollHeight = 1000;
  let _clientHeight = 500;
  Object.defineProperty(el, 'scrollTop', {
    get() { return _scrollTop; },
    set(v) { _scrollTop = v; },
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', {
    get() { return _scrollHeight; },
    set(v) { _scrollHeight = v; },
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    get() { return _clientHeight; },
    configurable: true,
  });
  return el;
}

function createActionBtns() {
  return [1, 2, 3].map((i) => {
    const btn = document.createElement('button');
    btn.dataset.action = `action${i}`;
    return btn;
  });
}

describe('dom-helpers', () => {
  let chatArea, actionBtns, sendBtn;

  beforeEach(() => {
    document.body.innerHTML = '';
    chatArea = createChatArea();
    actionBtns = createActionBtns();
    sendBtn = document.createElement('button');
    document.body.appendChild(chatArea);
    initDOMHelpers({ chatArea, actionBtns, sendBtn });
    vi.clearAllMocks();
  });

  describe('appendMessage', () => {
    it('removes welcome message when present', () => {
      const welcome = document.createElement('div');
      welcome.className = 'welcome-msg';
      chatArea.appendChild(welcome);

      appendMessage('user', 'hello');
      expect(chatArea.querySelector('.welcome-msg')).toBeNull();
    });

    it('appends user message with textContent', () => {
      appendMessage('user', 'hello');
      const msg = chatArea.querySelector('.message-user');
      expect(msg).not.toBeNull();
      expect(msg.textContent).toBe('hello');
    });

    it('appends ai message with parsed markdown', () => {
      appendMessage('ai', '**bold**');
      const msg = chatArea.querySelector('.message-ai');
      expect(msg).not.toBeNull();
      expect(msg.innerHTML).toContain('<strong>bold</strong>');
    });

    it('appends ai message without content as empty div', () => {
      appendMessage('ai', '');
      const msg = chatArea.querySelector('.message-ai');
      expect(msg).not.toBeNull();
    });

    it('wraps user messages in user-msg-group', () => {
      appendMessage('user', 'test');
      const group = chatArea.querySelector('.user-msg-group');
      expect(group).not.toBeNull();
    });

    it('prepends bubble images for user messages with imageUris', () => {
      appendMessage('user', 'see this', ['data:image/png;base64,abc']);
      const images = chatArea.querySelectorAll('.bubble-img-thumb');
      expect(images.length).toBe(1);
    });

    it('does not add images for ai messages', () => {
      appendMessage('ai', 'no images', ['data:image/png;base64,abc']);
      const images = chatArea.querySelectorAll('.bubble-img-thumb');
      expect(images.length).toBe(0);
    });
  });

  describe('appendMessageWithQuote', () => {
    it('appends a user message with quote and text', () => {
      appendMessageWithQuote('quoted text', 'my reply', []);
      const msg = chatArea.querySelector('.message-user');
      expect(msg).not.toBeNull();
      expect(msg.innerHTML).toContain('quoted text');
      expect(msg.innerHTML).toContain('my reply');
    });

    it('includes bubble images when imageUris provided', () => {
      appendMessageWithQuote('quote', 'reply', ['data:image/png;base64,img1']);
      const images = chatArea.querySelectorAll('.bubble-img-thumb');
      expect(images.length).toBe(1);
    });

    it('wraps in user-msg-group', () => {
      appendMessageWithQuote('q', 'r');
      expect(chatArea.querySelector('.user-msg-group')).not.toBeNull();
    });
  });

  describe('buildBubbleImagesHtml', () => {
    it('generates img tags for each uri', () => {
      const html = buildBubbleImagesHtml(['uri1', 'uri2']);
      expect(html).toContain('src="uri1"');
      expect(html).toContain('src="uri2"');
      expect(html).toContain('bubble-images');
    });

    it('returns empty container for empty array', () => {
      const html = buildBubbleImagesHtml([]);
      expect(html).toBe('<div class="bubble-images"></div>');
    });
  });

  describe('prependBubbleImages', () => {
    it('inserts image container at the beginning of div', () => {
      const div = document.createElement('div');
      div.textContent = 'text';
      prependBubbleImages(div, ['data:image/png;base64,abc']);
      expect(div.firstElementChild.className).toBe('bubble-images');
    });
  });

  describe('wrapUserMessage', () => {
    it('wraps element in user-msg-group div', () => {
      const msg = document.createElement('div');
      const wrapper = wrapUserMessage(msg);
      expect(wrapper.className).toBe('user-msg-group');
      expect(wrapper.firstElementChild).toBe(msg);
    });
  });

  describe('removeLastMessage', () => {
    it('removes the last message from chat area', () => {
      appendMessage('user', 'msg1');
      appendMessage('ai', 'msg2');
      expect(chatArea.querySelectorAll('.message').length).toBe(2);

      removeLastMessage();
      expect(chatArea.querySelectorAll('.message').length).toBe(1);
    });

    it('removes entire user-msg-group when last message is inside one', () => {
      appendMessage('user', 'wrapped');
      appendMessage('ai', 'not wrapped');
      // Remove the ai message first
      removeLastMessage();
      expect(chatArea.querySelectorAll('.message').length).toBe(1);

      // Now remove the user message (inside user-msg-group)
      removeLastMessage();
      expect(chatArea.querySelectorAll('.message').length).toBe(0);
      expect(chatArea.querySelectorAll('.user-msg-group').length).toBe(0);
    });

    it('does nothing when no messages exist', () => {
      removeLastMessage();
      expect(chatArea.querySelectorAll('.message').length).toBe(0);
    });
  });

  describe('updateLastMessage', () => {
    it('updates the last message role and content', () => {
      appendMessage('user', 'hello');
      updateLastMessage('ai', 'response');
      const messages = chatArea.querySelectorAll('.message');
      const final = messages[messages.length - 1];
      expect(final.className).toContain('message-ai');
      expect(final.innerHTML).toContain('response');
    });

    it('sets textContent for non-ai roles', () => {
      appendMessage('user', 'hello');
      updateLastMessage('user', 'new text');
      const messages = chatArea.querySelectorAll('.message');
      const final = messages[messages.length - 1];
      expect(final.textContent).toBe('new text');
    });
  });

  describe('addTypingIndicator / removeTypingIndicator', () => {
    it('adds typing indicator to a message element', () => {
      const msg = document.createElement('div');
      const indicator = addTypingIndicator(msg);
      expect(indicator.className).toBe('typing-indicator');
      expect(msg.querySelector('.typing-indicator')).not.toBeNull();
    });

    it('removes typing indicator from DOM', () => {
      const msg = document.createElement('div');
      const indicator = addTypingIndicator(msg);
      removeTypingIndicator(indicator);
      expect(msg.querySelector('.typing-indicator')).toBeNull();
    });

    it('handles null indicator gracefully', () => {
      expect(() => removeTypingIndicator(null)).not.toThrow();
    });
  });

  describe('scrollToBottom', () => {
    it('sets scrollTop to scrollHeight', () => {
      scrollToBottom();
      expect(chatArea.scrollTop).toBe(1000);
    });
  });

  describe('smartScrollToBottom', () => {
    it('scrolls when near bottom (within threshold)', () => {
      // distanceToBottom = scrollHeight - scrollTop - clientHeight
      // = 1000 - 950 - 500 = -450 <= 80, so it should scroll
      Object.defineProperty(chatArea, 'scrollTop', {
        get() { return 950; },
        set(v) { this._scrollTop = v; },
        configurable: true,
      });
      smartScrollToBottom();
      expect(chatArea._scrollTop).toBe(1000);
    });

    it('does not scroll when far from bottom', () => {
      // distanceToBottom = 1000 - 0 - 500 = 500 > 80, no scroll
      Object.defineProperty(chatArea, 'scrollTop', {
        get() { return 0; },
        set(v) { this._scrollTop = v; },
        configurable: true,
      });
      smartScrollToBottom();
      // _scrollTop was never set (undefined), so scrollTop getter still returns 0
      expect(chatArea.scrollTop).toBe(0);
    });
  });

  describe('setButtonsDisabled', () => {
    it('disables all action buttons and morphs send into stop', () => {
      setButtonsDisabled(true);
      actionBtns.forEach(btn => expect(btn.disabled).toBe(true));
      // Send button stays enabled as the stop control
      expect(sendBtn.disabled).toBe(false);
      expect(sendBtn.classList.contains('is-stop')).toBe(true);
    });

    it('enables all action buttons and restores the send icon', () => {
      setButtonsDisabled(true);
      setButtonsDisabled(false);
      actionBtns.forEach(btn => expect(btn.disabled).toBe(false));
      expect(sendBtn.disabled).toBe(false);
      expect(sendBtn.classList.contains('is-stop')).toBe(false);
    });

    it('skips podcast action button', () => {
      actionBtns[0].dataset.action = 'podcast';
      setButtonsDisabled(true);
      expect(actionBtns[0].disabled).toBe(false);
      expect(actionBtns[1].disabled).toBe(true);
    });
  });

  describe('retry button', () => {
    it('emits RETRY event when clicked', () => {
      appendMessage('user', 'retry me');
      const retryBtn = chatArea.querySelector('.msg-action-btn[title="[action.retry]"]');
      expect(retryBtn).not.toBeNull();
      retryBtn.click();
      expect(emit).toHaveBeenCalledWith(EVENTS.RETRY, expect.any(Object));
    });
  });

  describe('edit button', () => {
    it('emits EDIT event with original rawText and edited text on save', () => {
      const msgEl = appendMessage('user', 'original text');
      msgEl.dataset.rawText = 'original text';
      msgEl.dataset.rawDisplay = 'original text';

      const editBtn = chatArea.querySelector('.msg-action-btn[title="[action.edit]"]');
      expect(editBtn).not.toBeNull();
      editBtn.click();

      const ta = msgEl.querySelector('.msg-edit-textarea');
      expect(ta).not.toBeNull();
      expect(ta.value).toBe('original text');

      ta.value = 'edited text';
      msgEl.querySelector('.msg-edit-save').click();

      expect(emit).toHaveBeenCalledWith(EVENTS.EDIT, {
        wrapper: expect.any(HTMLElement),
        originalRawText: 'original text',
        editedText: 'edited text',
        rawQuote: undefined,
      });
    });

    it('does not emit EDIT when saving empty text', () => {
      const msgEl = appendMessage('user', 'keep me');
      msgEl.dataset.rawDisplay = 'keep me';

      chatArea.querySelector('.msg-action-btn[title="[action.edit]"]').click();
      const ta = msgEl.querySelector('.msg-edit-textarea');
      ta.value = '   ';
      emit.mockClear();
      msgEl.querySelector('.msg-edit-save').click();
      expect(emit).not.toHaveBeenCalled();
    });

    it('restores original bubble on cancel', () => {
      const msgEl = appendMessage('user', 'restore me');
      msgEl.dataset.rawDisplay = 'restore me';
      const originalHtml = msgEl.innerHTML;

      chatArea.querySelector('.msg-action-btn[title="[action.edit]"]').click();
      expect(msgEl.querySelector('.msg-edit-textarea')).not.toBeNull();
      msgEl.querySelector('.msg-edit-cancel').click();

      expect(msgEl.querySelector('.msg-edit-textarea')).toBeNull();
      expect(msgEl.innerHTML).toBe(originalHtml);
      // actions row re-shown
      const actions = msgEl.closest('.user-msg-group').querySelector('.msg-actions');
      expect(actions.style.display).not.toBe('none');
    });
  });

  describe('appendMessageFromHistory — multimodal content', () => {
    it('extracts image_url blocks from array content and renders thumbnails', () => {
      const msg = {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } },
        ],
      };
      const div = appendMessageFromHistory(msg);

      expect(div.textContent).toContain('看这张图');
      const imgs = div.querySelectorAll('img.bubble-img-thumb');
      expect(imgs.length).toBe(1);
      expect(imgs[0].src).toBe('data:image/png;base64,ABC');
    });

    it('shows image-lost hint when hadImages=true but content is string (reload state)', () => {
      const msg = {
        role: 'user',
        content: '原本有图的文字',
        hadImages: true,
      };
      const div = appendMessageFromHistory(msg);

      expect(div.textContent).toContain('原本有图的文字');
      expect(div.querySelector('.image-lost-hint')).not.toBeNull();
    });

    it('renders plain string content without image-lost hint when hadImages absent', () => {
      const msg = { role: 'user', content: '纯文字' };
      const div = appendMessageFromHistory(msg);

      expect(div.textContent).toContain('纯文字');
      expect(div.querySelector('.image-lost-hint')).toBeNull();
    });

    it('renders assistant message as ai role (markdown)', () => {
      const msg = { role: 'assistant', content: 'AI 回复' };
      const div = appendMessageFromHistory(msg);

      expect(div.className).toContain('message-ai');
    });
  });
});
