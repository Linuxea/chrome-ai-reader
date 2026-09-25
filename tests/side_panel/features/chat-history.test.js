import { vi, describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { dbClear } from '../../../src/shared/db';
import { listChats, __resetChatsMigration } from '../../../src/shared/chats-db';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
  getCurrentLang: vi.fn(() => 'zh'),
}));

vi.mock('../../../src/shared/constants.js', () => ({
  escapeHtml: (text) => text,
}));

vi.mock('../../../src/shared/format.js', () => ({
  formatDate: (ts) => `formatted:${ts}`,
}));

vi.mock('../../../src/shared/download.js', () => ({
  downloadFile: vi.fn(),
}));

vi.mock('../../../src/side_panel/state.js', () => ({
  getCurrentChatId: vi.fn(() => null),
  getConversationHistory: vi.fn(() => []),
  getPageTitle: vi.fn(() => 'Test Page'),
  setCurrentChatId: vi.fn(),
  getIsGenerating: vi.fn(() => false),
  getActiveTabId: vi.fn(() => 1),
  getStateForTab: vi.fn(() => ({ pageUrl: 'https://page.example/a' })),
}));

async function resetChatsDb() {
  __resetChatsMigration();
  await dbClear('chats');
}

vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({
  scrollToBottom: vi.fn(),
}));

vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: { REQUEST_RERENDER: 'requestRerender' },
}));

vi.mock('../../../src/side_panel/ui/markdown.js', async (importOriginal) => ({
  ...(await importOriginal()),
  renderMarkdown: (text) => `<p>${text}</p>`,
}));

import {
  generateTitle,
  sanitizeFilename,
  stripHtml,
  initChatHistory,
  getDisplayMessages,
  stripMessageChrome,
  renderHistoryList,
  saveCurrentChat,
} from '../../../src/side_panel/features/chat-history.js';
import * as stateMock from '../../../src/side_panel/state.js';
import { emit } from '../../../src/side_panel/events.js';

describe('generateTitle', () => {
  it('returns full text when user message < 30 chars', () => {
    const messages = [{ role: 'user', content: 'Hello world' }];
    expect(generateTitle(messages)).toBe('Hello world');
  });

  it('truncates with "..." when user message > 30 chars', () => {
    const long = 'a'.repeat(40);
    const messages = [{ role: 'user', content: long }];
    expect(generateTitle(messages)).toBe('a'.repeat(30) + '...');
  });

  it('returns default when no user message', () => {
    const messages = [{ role: 'assistant', content: 'hi' }];
    expect(generateTitle(messages)).toBe('[chat.newChat]');
  });

  it('does not add ellipsis when user message is exactly 30 chars', () => {
    const exact = 'b'.repeat(30);
    const messages = [{ role: 'user', content: exact }];
    expect(generateTitle(messages)).toBe(exact);
  });
});

describe('sanitizeFilename', () => {
  it('replaces slashes and backslashes', () => {
    expect(sanitizeFilename('foo/bar\\baz')).toBe('foo_bar_baz');
  });

  it('replaces colons, asterisks, question marks', () => {
    expect(sanitizeFilename('a:b*c?d')).toBe('a_b_c_d');
  });

  it('replaces angle brackets and pipe', () => {
    expect(sanitizeFilename('<a>|b')).toBe('_a__b');
  });

  it('replaces newlines and carriage returns', () => {
    expect(sanitizeFilename('line1\nline2\rline3')).toBe('line1_line2_line3');
  });

  it('replaces double quotes', () => {
    expect(sanitizeFilename('say "hello"')).toBe('say _hello_');
  });

  it('truncates to 30 chars', () => {
    expect(sanitizeFilename('a'.repeat(50)).length).toBe(30);
  });

  it('returns unchanged when no unsafe chars and <= 30', () => {
    expect(sanitizeFilename('simple title 123')).toBe('simple title 123');
  });

  it('handles empty string', () => {
    expect(sanitizeFilename('')).toBe('');
  });
});

describe('stripHtml', () => {
  it('strips HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('handles HTML entities', () => {
    expect(stripHtml('a &amp; b &lt; c')).toBe('a & b < c');
  });

  it('passes plain text through', () => {
    expect(stripHtml('just text')).toBe('just text');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('stripMessageChrome / getDisplayMessages', () => {
  function setupChatArea() {
    const chatArea = document.createElement('div');
    initChatHistory({
      chatArea,
      historyPanel: document.createElement('div'),
      historyList: document.createElement('div'),
      onLoadChat: vi.fn(),
      onRenderOutline: vi.fn(),
      onOutlineToMarkdown: vi.fn(),
    });
    return chatArea;
  }

  it('strips persisted UI chrome from legacy HTML', () => {
    const legacy = '<p>answer</p>' +
      '<button class="ai-action-btn">copy</button>' +
      '<button class="tts-btn">tts</button>' +
      '<button class="tts-download-btn">dl</button>' +
      '<details class="thinking-block"><summary>thinking</summary><div>reasoning</div></details>' +
      '<div class="typing-indicator"><span></span></div>';
    expect(stripMessageChrome(legacy)).toBe('<p>answer</p>');
  });

  it('leaves content-only HTML untouched', () => {
    expect(stripMessageChrome('<p>hello <strong>world</strong></p><pre><code>x</code></pre>'))
      .toBe('<p>hello <strong>world</strong></p><pre><code>x</code></pre>');
  });

  it('getDisplayMessages uses a placeholder for an image-only user message', () => {
    const chatArea = setupChatArea();
    const user = document.createElement('div');
    user.className = 'message message-user';
    user.innerHTML = '<div class="bubble-images"><img src="data:image/png;base64,A"></div>';
    chatArea.appendChild(user);

    expect(getDisplayMessages()).toEqual([{ role: 'user', content: '[chat.imageOnly]' }]);
  });

  it('getDisplayMessages persists assistant content without buttons', () => {
    const chatArea = setupChatArea();

    const ai = document.createElement('div');
    ai.className = 'message message-ai';
    ai.innerHTML = '<p>answer</p><button class="tts-btn"></button><details class="thinking-block"><summary>s</summary></details>';
    chatArea.appendChild(ai);

    const user = document.createElement('div');
    user.className = 'message message-user';
    user.textContent = 'question';
    chatArea.appendChild(user);

    expect(getDisplayMessages()).toEqual([
      { role: 'assistant', content: '<p>answer</p>' },
      { role: 'user', content: 'question' },
    ]);
  });

  it('getDisplayMessages stores the Markdown source of an answer, not its rendered HTML', () => {
    const chatArea = setupChatArea();
    const ai = document.createElement('div');
    ai.className = 'message message-ai';
    ai.dataset.markdown = '**answer** ![x](https://evil.example/p.gif)';
    ai.innerHTML = '<p><strong>answer</strong></p>';
    chatArea.appendChild(ai);

    expect(getDisplayMessages()).toEqual([
      { role: 'assistant', content: '**answer** ![x](https://evil.example/p.gif)', format: 'md' },
    ]);
  });

  it('stripMessageChrome also sanitizes the snapshot (scripts, handlers, remote images)', () => {
    const out = stripMessageChrome('<p onclick="x()">a</p><script>alert(1)</script><img src="https://evil.example/p.gif">');
    expect(out).not.toMatch(/script|onclick|<img/);
    expect(out).toContain('<p>a</p>');
  });
});

describe('loading a saved chat', () => {
  beforeEach(resetChatsDb);

  // Seeds the chat through the legacy storage.local blob, so the one-time
  // migration into IndexedDB is exercised on the way.
  async function openChat(chat) {
    globalThis.chrome = {
      storage: { local: { get: vi.fn(async () => ({ chatHistories: [chat] })), remove: vi.fn(async () => {}) } },
    };
    const chatArea = document.createElement('div');
    const historyPanel = document.createElement('div');
    const historyList = document.createElement('div');
    const onLoadChat = vi.fn();
    initChatHistory({ chatArea, historyPanel, historyList, onLoadChat, onRenderOutline: vi.fn(), onOutlineToMarkdown: vi.fn() });
    await renderHistoryList();
    historyList.querySelector('.history-item-info').click();
    await new Promise(r => setTimeout(r, 0));
    return { chatArea, historyPanel, onLoadChat };
  }

  it('renders from conversationHistory via the shared re-render path (retry / edit work)', async () => {
    emit.mockClear();
    const { chatArea, historyPanel, onLoadChat } = await openChat({
      id: 'c1', title: 't', updatedAt: 1,
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: '<p>a</p>' }],
      conversationHistory: [{ role: 'user', content: 'q', meta: { rawText: 'q', displayText: 'q' } }, { role: 'assistant', content: 'a' }],
    });

    expect(onLoadChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(emit).toHaveBeenCalledWith('requestRerender');
    expect(chatArea.children).toHaveLength(0); // not built from the display snapshot
    expect(historyPanel.classList.contains('hidden')).toBe(true);
  });

  it('sanitizes a legacy HTML answer snapshot before rendering it', async () => {
    const { chatArea } = await openChat({
      id: 'c3', title: 't', updatedAt: 1,
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '<p>a</p><img src="https://evil.example/leak.gif"><script>alert(1)</script>' },
      ],
      conversationHistory: [],
    });

    const ai = chatArea.querySelector('.message-ai');
    expect(ai.querySelector('img, script')).toBeNull();
    expect(ai.textContent).toContain('a');
  });

  it('renders a Markdown-format display snapshot through the Markdown path', async () => {
    const { chatArea } = await openChat({
      id: 'c4', title: 't', updatedAt: 1,
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'md answer', format: 'md' }],
      conversationHistory: [],
    });

    const ai = chatArea.querySelector('.message-ai');
    expect(ai.innerHTML).toContain('<p>md answer</p>');
    expect(ai.dataset.markdown).toBe('md answer');
  });

  it('falls back to the display snapshot for legacy records without history', async () => {
    emit.mockClear();
    const { chatArea } = await openChat({
      id: 'c2', title: 't', updatedAt: 1,
      messages: [{ role: 'user', content: 'legacy q' }],
      conversationHistory: [],
    });

    expect(emit).not.toHaveBeenCalledWith('requestRerender');
    expect(chatArea.textContent).toContain('legacy q');
  });
});

describe('saveCurrentChat', () => {
  let chatArea;
  let currentId;

  beforeEach(async () => {
    await resetChatsDb();
    currentId = null;
    stateMock.getCurrentChatId.mockImplementation(() => currentId);
    stateMock.setCurrentChatId.mockImplementation((id) => { currentId = id; });
    globalThis.chrome = { storage: { local: { get: vi.fn(async () => ({})), remove: vi.fn(async () => {}) } } };
    chatArea = document.createElement('div');
    initChatHistory({
      chatArea, historyPanel: document.createElement('div'), historyList: document.createElement('div'),
      onLoadChat: vi.fn(), onRenderOutline: vi.fn(), onOutlineToMarkdown: vi.fn(),
    });
  });

  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'message message-user';
    el.textContent = text;
    chatArea.appendChild(el);
  }

  it('overlapping saves of a new chat create ONE history entry', async () => {
    addUserMessage('hello');
    await Promise.all([saveCurrentChat(), saveCurrentChat()]);
    const saved = await listChats();
    expect(saved).toHaveLength(1);
    expect(saved[0].pageUrl).toBe('https://page.example/a');
  });

  it('"new chat" right after a save keeps the two conversations apart', async () => {
    addUserMessage('first chat');
    const pending = saveCurrentChat();
    // new chat: clears the id and the chat area before the save finishes
    stateMock.setCurrentChatId(null);
    chatArea.innerHTML = '';
    await pending;
    expect(currentId).toBeNull(); // the old id was not stamped onto the new chat

    addUserMessage('second chat');
    await saveCurrentChat();
    expect((await listChats()).map(h => h.title).sort()).toEqual(['first chat', 'second chat']);
  });

  it('keeps the quote apart from the question (titles show the question)', () => {
    const el = document.createElement('div');
    el.className = 'message message-user';
    el.dataset.rawDisplay = 'What does this mean?';
    el.dataset.rawQuote = 'A long quoted paragraph from the page';
    el.innerHTML = '<blockquote class="quote-in-bubble">A long quoted…</blockquote><span>What does this mean?</span>';
    chatArea.appendChild(el);

    expect(getDisplayMessages()).toEqual([
      { role: 'user', content: 'What does this mean?', quote: 'A long quoted paragraph from the page' },
    ]);
  });
});
