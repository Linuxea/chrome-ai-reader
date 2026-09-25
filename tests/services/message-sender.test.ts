/**
 * Tests for side_panel/services/message-sender.ts — message assembly + send flow.
 *
 * Tests:
 * - sendToAI: system prompt + page context assembly, conversation history,
 *   quote handling (truncation + prefix), image parts, error rollback
 * - sendMessage: reads from textarea, validates images, clears input
 * - retryMessage: removes messages after wrapper, splices history
 *
 * All dependencies are mocked via vi.mock.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mock all dependencies ---

vi.mock('../../src/shared/i18n.js', () => ({
  // t() returns interpolated bracket-key format so we can verify params
  t: (key: string, params?: Record<string, unknown>) => {
    if (!params) return `[${key}]`;
    const paramStr = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `[${key}:{${paramStr}}]`;
  },
  getCurrentLang: () => 'zh',
}));

vi.mock('../../src/shared/prompts', () => ({
  // Mirror the i18n mock's interpolation so prompt params are observable.
  getPrompt: (key: string, _lang?: string, params?: Record<string, unknown>) => {
    if (!params) return `[${key}]`;
    const paramStr = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `[${key}:{${paramStr}}]`;
  },
}));

vi.mock('../../src/shared/constants.js', () => ({
  TRUNCATE_LIMITS: { CONTEXT: 1000, QUOTE: 200 },
  // Pass-through safeTruncate that just slices — simple enough for test assertions
  safeTruncate: (text: string, _limit: number, _suffix?: string) => text,
}));

vi.mock('../../src/shared/utils.js', () => ({
  toErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../src/side_panel/state.js', () => ({
  getActiveTabId: vi.fn(() => 1),
  getStateForTab: vi.fn(),
  persistForTab: vi.fn(),
  getCustomSystemPrompt: vi.fn(() => ''),
  setIsGenerating: vi.fn(),
  setGeneratingForTab: vi.fn(),
  getIsGenerating: vi.fn(() => false),
}));

vi.mock('../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: {
    REMOVE_SUGGEST_QUESTIONS: 'removeSuggestQuestions',
    CLEAR_QUOTE_PREVIEW: 'clearQuotePreview',
  },
}));

vi.mock('../../src/side_panel/ui/dom-helpers.js', () => {
  const makeEl = () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  };
  const appendMessage = vi.fn(makeEl);
  const appendMessageWithQuote = vi.fn(makeEl);
  return {
    appendMessage,
    appendMessageWithQuote,
    // Mirrors the real renderer's contract: quote → quote bubble (50-char
    // preview), otherwise a plain bubble; datasets feed retry / edit.
    appendUserMessage: vi.fn((b: { rawText: string; displayText: string; quote?: string; imageUris?: string[] }) => {
      let el: HTMLDivElement;
      if (b.quote) {
        const preview = b.quote.length > 50 ? b.quote.slice(0, 50) + '...' : b.quote;
        el = appendMessageWithQuote(preview, b.displayText, b.imageUris) as HTMLDivElement;
        el.dataset.rawQuote = b.quote;
      } else {
        el = appendMessage('user', b.displayText, b.imageUris) as HTMLDivElement;
      }
      el.dataset.rawText = b.rawText;
      el.dataset.rawDisplay = b.displayText;
      return el;
    }),
    appendErrorMessage: vi.fn(makeEl),
    appendNoteMessage: vi.fn(makeEl),
    emitRetryFromWrapper: vi.fn(),
    updateSendButtonDim: vi.fn(),
    removeLastMessage: vi.fn(),
    setButtonsDisabled: vi.fn(),
  };
});

vi.mock('../../src/side_panel/services/tts/index.js', () => ({
  isTTSPlaying: vi.fn(() => false),
  stopTTS: vi.fn(),
}));

vi.mock('../../src/side_panel/services/images.js', () => ({
  collectImageDataUris: vi.fn(() => []),
  clearImagePreviews: vi.fn(),
  hasPendingImages: vi.fn(() => false),
}));

vi.mock('../../src/side_panel/services/page-extractor.js', () => ({
  ensurePageContent: vi.fn(() => Promise.resolve({ ok: true, value: null })),
  extractTabContent: vi.fn((id: number) => Promise.resolve(id === 9
    ? { ok: false, error: new Error('nope') }
    : { ok: true, value: { title: `Tab ${id}`, url: `https://t${id}.example`, textContent: `content of ${id}`, excerpt: '' } })),
}));

vi.mock('../../src/side_panel/services/stream-handler.js', () => ({
  callAI: vi.fn(() => Promise.resolve()),
  takePendingAbort: vi.fn(() => false),
}));

vi.mock('../../src/side_panel/services/chat/history-ops.js', () => ({
  appendMessage: vi.fn((ts: { conversationHistory: unknown[] }, msg: unknown) => {
    ts.conversationHistory.push(msg);
  }),
  rollbackTrailingUserMessage: vi.fn((ts: { conversationHistory: { role: string }[] }) => {
    const hist = ts.conversationHistory;
    if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
      hist.splice(hist.length - 1, 1);
      return true;
    }
    return false;
  }),
  toApiMessage: vi.fn((m: { role: string; content: unknown }) => ({ role: m.role, content: m.content })),
  truncateHistoryFromId: vi.fn((ts: { conversationHistory: { id?: string }[] }, id: string) => {
    const hist = ts.conversationHistory;
    const idx = hist.findIndex(m => m.id === id);
    if (idx !== -1) hist.splice(idx, hist.length - idx);
    return idx;
  }),
  // Branching behaves like truncation for these tests (branches are covered in history-ops tests).
  branchFromId: vi.fn((ts: { conversationHistory: { id?: string }[] }, id: string) => {
    const hist = ts.conversationHistory;
    const idx = hist.findIndex(m => m.id === id);
    if (idx !== -1) hist.splice(idx, hist.length - idx);
    return idx;
  }),
  anchorAt: vi.fn(() => '__root__'),
  branchInfo: vi.fn(() => null),
  truncateHistoryFromUserContent: vi.fn((ts: { conversationHistory: unknown[] }, content: unknown) => {
    const hist = ts.conversationHistory;
    const idx = hist.findLastIndex((m: { role: string; content: unknown }) =>
      m.role === 'user' && m.content === content);
    if (idx !== -1) hist.splice(idx, hist.length - idx);
    return idx;
  }),
}));


const { settingsMock } = vi.hoisted(() => ({ settingsMock: { citations: false } as Record<string, unknown> }));
vi.mock('../../src/platform/settings.js', () => ({
  readSettings: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settingsMock[k]]))),
}));

// --- Import after mocks ---
import {
  initMessageSender,
  sendToAI,
  sendMessage,
  retryMessage,
  editMessage,
  submit,
} from '../../src/side_panel/services/message-sender.js';
import { initComposer } from '../../src/side_panel/services/composer.js';
import * as stateMock from '../../src/side_panel/state.js';
import * as eventsMock from '../../src/side_panel/events.js';
import * as domMock from '../../src/side_panel/ui/dom-helpers.js';
import * as imagesMock from '../../src/side_panel/services/images.js';
import { ensurePageContent } from '../../src/side_panel/services/page-extractor.js';
import { callAI, takePendingAbort } from '../../src/side_panel/services/stream-handler.js';
import { appendMessage as appendHistory, truncateHistoryFromUserContent } from '../../src/side_panel/services/chat/history-ops.js';

describe('services/message-sender', () => {
  let tabState: Record<string, unknown>;
  let userInput: HTMLTextAreaElement;
  let chatArea: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    // Reset tabState to fresh defaults
    tabState = {
      isGenerating: false,
      conversationHistory: [],
      pageContent: 'Existing page content',
      pageTitle: 'Test Page',
      selectedText: '',
      isPodcastGenerating: false,
    };

    // Re-establish ALL mock implementations — clearAllMocks only clears
    // call history, NOT implementations. Tests that override mocks
    // (e.g. mockRejectedValue) would leak into subsequent tests without this.
    stateMock.getStateForTab.mockReturnValue(tabState);
    stateMock.getActiveTabId.mockReturnValue(1);
    stateMock.getIsGenerating.mockReturnValue(false);
    stateMock.setGeneratingForTab.mockImplementation((id: number, v: boolean) => {
      tabState.isGenerating = v;
      stateMock.persistForTab(id);
    });
    stateMock.getCustomSystemPrompt.mockReturnValue('');
    (ensurePageContent as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve({ ok: true, value: null }),
    );
    (callAI as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.mocked(takePendingAbort).mockReturnValue(false);
    imagesMock.collectImageDataUris.mockReturnValue([]);
    imagesMock.clearImagePreviews.mockImplementation(() => {});
    imagesMock.hasPendingImages.mockReturnValue(false);

    userInput = document.createElement('textarea');
    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);

    initMessageSender({ chatArea });
    initComposer({ userInput });
  });

  // ==========================================================================
  // sendToAI
  // ==========================================================================
  describe('sendToAI', () => {
    it('emits REMOVE_SUGGEST_QUESTIONS at start', async () => {
      await sendToAI('hello', 'hello');
      expect(eventsMock.emit).toHaveBeenCalledWith('removeSuggestQuestions');
    });

    it('returns early if no tabState', async () => {
      stateMock.getStateForTab.mockReturnValue(null);
      await sendToAI('text', 'text');
      expect(callAI).not.toHaveBeenCalled();
    });

    it('sets isGenerating=true and disables buttons', async () => {
      await sendToAI('text', 'text');
      expect(tabState.isGenerating).toBe(true);
      expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(true);
    });

    it('splits the system into a rules message and an article message', async () => {
      await sendToAI('question', 'question');

      expect(callAI).toHaveBeenCalled();
      const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // Two system messages: [0] rules (short), [1] article (data).
      const systemMsgs = messages.filter((m: { role: string }) => m.role === 'system');
      expect(systemMsgs).toHaveLength(2);
      // Rules message must NOT contain the article text.
      expect(systemMsgs[0].content).not.toContain('Existing page content');
      // Article message carries the title + content.
      expect(systemMsgs[1].content).toContain('Test Page');
      expect(systemMsgs[1].content).toContain('Existing page content');
    });

    it('places the custom prompt in the short rules message, not the article', async () => {
      stateMock.getCustomSystemPrompt.mockReturnValue('Be concise');
      await sendToAI('q', 'q');

      const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemMsgs = messages.filter((m: { role: string }) => m.role === 'system');
      expect(systemMsgs).toHaveLength(2);
      // Custom rides in the rules message (where the model attends) — never
      // in the long article message where it would be buried.
      expect(systemMsgs[0].content).toContain('Be concise');
      expect(systemMsgs[1].content).not.toContain('Be concise');
    });

    it('with citations on, adds the citation rule and labels the article paragraphs [#N]', async () => {
      settingsMock.citations = true;
      try {
        tabState.pageContent = 'First paragraph text.\n\nSecond paragraph text.';
        tabState.pageParagraphs = ['First paragraph text.', 'Second paragraph text.'];
        await sendToAI('q', 'q');
        const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(messages[0].content).toContain('citations.rule'); // getPrompt is mocked to echo keys
        expect(messages[1].content).toContain('[#0] First paragraph text.');
        expect(messages[1].content).toContain('[#1] Second paragraph text.');
      } finally {
        settingsMock.citations = false;
      }
    });

    it('a page over the budget sends the relevant part and says it is partial', async () => {
      const paras = Array.from({ length: 3000 }, (_, i) => `Filler paragraph number ${i} with nothing special in it.`);
      paras[2500] = 'The secret launch code is described here.';
      tabState.pageContent = paras.join('\n\n');
      tabState.pageParagraphs = paras;
      await sendToAI('what is the secret launch code', 'd');
      const article = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content as string;
      expect(article).toContain('[#2500] The secret launch code');
      expect(article).toContain('…');
      expect(article.length).toBeLessThan(70_000);
    });

    it('F4: reads attached tabs fresh into a system message and records them in meta', async () => {
      await sendToAI('compare', 'compare', undefined, undefined, [
        { id: 5, title: 'Five', url: 'https://t5.example' },
        { id: 9, title: 'Nine', url: 'https://t9.example' },
      ]);
      const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0] as { role: string; content: string }[];
      const multi = messages.find((m) => typeof m.content === 'string' && m.content.includes('multitab.context'));
      expect(multi?.role).toBe('system');
      expect(multi?.content).toContain('content of 5');
      expect(multi?.content).toContain('multitab.unreadable');
      const userMsg = tabState.conversationHistory.at(-1) as { meta: { tabs: unknown[] } };
      expect(userMsg.meta.tabs).toEqual([
        { id: 5, title: 'Five', url: 'https://t5.example' },
        { id: 9, title: 'Nine', url: 'https://t9.example' },
      ]);
    });

    it('includes conversation history in messages', async () => {
      tabState.conversationHistory = [
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' },
      ];

      await sendToAI('new question', 'new question');

      const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // Should include the history items
      expect(messages.some((m: { content: string }) => m.content === 'previous question')).toBe(true);
      expect(messages.some((m: { content: string }) => m.content === 'previous answer')).toBe(true);
    });

    it('appends user message to conversation history, with what the user entered as meta', async () => {
      await sendToAI('my question', 'display');

      expect(tabState.conversationHistory).toContainEqual({
        id: expect.any(String),
        role: 'user',
        content: 'my question',
        meta: { rawText: 'my question', displayText: 'display' },
      });
    });

    it('records the full quote in meta (content holds the assembled prompt)', async () => {
      await sendToAI('q', 'q', 'the quoted text');
      const hist = tabState.conversationHistory as { content: unknown; meta: unknown }[];
      expect(hist[0].meta).toEqual({ rawText: 'q', displayText: 'q', quote: 'the quoted text' });
      expect(hist[0].content).toBe('[ai.quotePrefix]\n\nthe quoted text\n\nq');
    });

    it('sends only role + content to the API (no local meta / hadImages)', async () => {
      tabState.conversationHistory = [{ role: 'user', content: 'old', meta: { rawText: 'old', displayText: 'old' }, hadImages: true }];
      await sendToAI('new', 'new');
      const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>[];
      for (const m of messages) expect(Object.keys(m).sort()).toEqual(['content', 'role']);
    });

    it('calls ensurePageContent to guarantee extraction before sending', async () => {
      tabState.conversationHistory = [];
      tabState.pageContent = '';

      await sendToAI('first question', 'first question');

      expect(ensurePageContent).toHaveBeenCalledWith(1);
    });

    it('still calls ensurePageContent even when pageContent is cached', async () => {
      // The gate is now single-source: ensurePageContent is always called;
      // it internally no-ops when pageContent is present. This replaces the
      // old scattered "if (!conv || !pageContent)" checks.
      tabState.pageContent = 'already have content';
      tabState.conversationHistory = [{ role: 'user', content: 'prev' }];

      await sendToAI('next', 'next');

      expect(ensurePageContent).toHaveBeenCalled();
    });

    it('appends user message with quote prefix when quoteForContext provided', async () => {
      await sendToAI('question', 'display', 'quoted text');

      // The history entry should contain the quote prefix
      const userEntry = tabState.conversationHistory.find(
        (m: { role: string }) => m.role === 'user',
      );
      expect(userEntry.content).toContain('[ai.quotePrefix]');
      expect(userEntry.content).toContain('quoted text');
      expect(userEntry.content).toContain('question');
    });

    it('uses appendMessageWithQuote when quote is present', async () => {
      await sendToAI('q', 'q', 'quote');

      expect(domMock.appendMessageWithQuote).toHaveBeenCalled();
      expect(eventsMock.emit).toHaveBeenCalledWith('clearQuotePreview');
    });

    it('uses regular appendMessage when no quote', async () => {
      await sendToAI('q', 'q');

      expect(domMock.appendMessage).toHaveBeenCalledWith('user', 'q', undefined);
    });

    it('passes imageUris to appendMessage', async () => {
      const images = ['data:image/png;base64,abc'];
      await sendToAI('q', 'q', undefined, images);

      expect(domMock.appendMessage).toHaveBeenCalledWith('user', 'q', images);
    });

    it('keeps the user bubble and shows an actionable error on callAI failure', async () => {
      (callAI as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stream failed'));

      await sendToAI('question', 'question');

      // The user bubble stays; an error bubble reports the failure instead.
      // (Retry actions attach only when a real user-msg-group wrapper exists —
      // covered by dom-helpers tests.)
      expect(domMock.removeLastMessage).not.toHaveBeenCalled();
      expect(domMock.appendErrorMessage).toHaveBeenCalledWith('stream failed', expect.anything());
      expect(tabState.conversationHistory).not.toContainEqual(
        expect.objectContaining({ role: 'user' }),
      );
      expect(tabState.isGenerating).toBe(false);
      expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(false);
    });

    it('Stop during page extraction cancels the send (nothing reaches the model or history)', async () => {
      vi.mocked(takePendingAbort).mockReturnValueOnce(true);

      await sendToAI('q', 'q');

      expect(callAI).not.toHaveBeenCalled();
      expect(tabState.conversationHistory).toHaveLength(0);
      expect(tabState.isGenerating).toBe(false);
      expect(domMock.appendNoteMessage).toHaveBeenCalledWith('[ai.stopped]');
      expect(domMock.setButtonsDisabled).toHaveBeenLastCalledWith(false);
    });

    it('rolls back on ensurePageContent failure', async () => {
      tabState.pageContent = '';
      tabState.conversationHistory = [];
      (ensurePageContent as ReturnType<typeof vi.fn>).mockReturnValue(
        Promise.resolve({ ok: false, error: new Error('extract failed') }),
      );

      await sendToAI('q', 'q');

      expect(domMock.appendErrorMessage).toHaveBeenCalledWith(
        'extract failed',
        expect.anything(),
      );
      expect(callAI).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // sendMessage
  // ==========================================================================
  describe('sendMessage', () => {
    it('sends text from user input', async () => {
      userInput.value = '  hello world  ';
      await sendMessage();

      expect(callAI).toHaveBeenCalled();
      // Input should be cleared
      expect(userInput.value).toBe('');
    });

    it('returns early for empty input', async () => {
      userInput.value = '   ';
      await sendMessage();

      expect(callAI).not.toHaveBeenCalled();
    });

    it('keeps text and images when the images are too large to send', async () => {
      userInput.value = 'look';
      imagesMock.collectImageDataUris.mockReturnValue(['x'.repeat(11 * 1024 * 1024)]);

      await sendMessage();

      expect(domMock.appendMessage).toHaveBeenCalledWith('error', '[error.visionPayloadTooLarge]');
      expect(userInput.value).toBe('look');
      expect(imagesMock.clearImagePreviews).not.toHaveBeenCalled();
      expect(callAI).not.toHaveBeenCalled();
    });

    it('sends an image-only message (no text, pending images)', async () => {
      userInput.value = '';
      imagesMock.hasPendingImages.mockReturnValue(true);
      imagesMock.collectImageDataUris.mockReturnValue(['data:image/png;base64,A']);

      await sendMessage();

      expect(domMock.appendMessage).toHaveBeenCalledWith('user', '', ['data:image/png;base64,A']);
      const hist = tabState.conversationHistory as { content: unknown }[];
      // no empty text part — just the image
      expect(hist[hist.length - 1].content).toEqual([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,A' } },
      ]);
    });

    it('returns early when isGenerating is true', async () => {
      userInput.value = 'text';
      stateMock.getIsGenerating.mockReturnValue(true);
      await sendMessage();

      expect(callAI).not.toHaveBeenCalled();
    });

    it('sends pending images with the text and clears previews', async () => {
      userInput.value = 'text';
      imagesMock.collectImageDataUris.mockReturnValue(['img1']);

      await sendMessage();

      expect(imagesMock.clearImagePreviews).toHaveBeenCalled();
      expect(domMock.appendMessage).toHaveBeenCalledWith('user', 'text', ['img1']);
    });
  });

  // ==========================================================================
  // submit — the single send pipeline shared by every entry point
  // ==========================================================================
  describe('submit', () => {
    const lastUserMessage = () => {
      const hist = tabState.conversationHistory as { role: string; content: unknown }[];
      return hist[hist.length - 1];
    };

    it('sends a prompt intent without a draft as-is', async () => {
      await submit({ prompt: 'PROMPT', display: 'Label' });
      expect(lastUserMessage().content).toBe('PROMPT');
      expect(domMock.appendMessage).toHaveBeenCalledWith('user', 'Label', []);
    });

    it('rides the draft along as extra instructions and clears the input', async () => {
      userInput.value = 'focus on part 2';
      await submit({ prompt: 'PROMPT', display: 'Label' });
      expect(lastUserMessage().content).toBe('PROMPT\n\n[draft.supplement:{draft=focus on part 2}]');
      expect(domMock.appendMessage).toHaveBeenCalledWith('user', 'Label · focus on part 2', []);
      expect(userInput.value).toBe('');
    });

    it('uses an explicit draft instead of the input value', async () => {
      userInput.value = '/cmd extra';
      await submit({ prompt: 'PROMPT', display: '/cmd', draft: '' });
      expect(lastUserMessage().content).toBe('PROMPT');
      expect(userInput.value).toBe('');
    });

    it('attaches pending images for prompt intents', async () => {
      imagesMock.collectImageDataUris.mockReturnValue(['data:image/png;base64,A']);
      await submit({ prompt: 'PROMPT', display: 'Label' });
      expect(lastUserMessage().content).toEqual([
        { type: 'text', text: 'PROMPT' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,A' } },
      ]);
    });
  });

  // ==========================================================================
  // retryMessage
  // ==========================================================================
  describe('retryMessage', () => {
    it('returns early when no tabState', async () => {
      stateMock.getStateForTab.mockReturnValue(null);
      await retryMessage(document.createElement('div'), 'text', 'display');
      expect(callAI).not.toHaveBeenCalled();
    });

    it('returns early when isGenerating', async () => {
      tabState.isGenerating = true;
      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);
      await retryMessage(wrapper, 'text', 'display');
      expect(callAI).not.toHaveBeenCalled();
    });

    it('removes all messages from wrapper onwards', async () => {
      const msg1 = document.createElement('div');
      const wrapper = document.createElement('div');
      const msg2 = document.createElement('div');
      const msg3 = document.createElement('div');
      chatArea.appendChild(msg1);
      chatArea.appendChild(wrapper);
      chatArea.appendChild(msg2);
      chatArea.appendChild(msg3);

      await retryMessage(wrapper, 'text', 'display');

      // msg1 should remain; wrapper, msg2, msg3 should be removed
      expect(chatArea.children).toHaveLength(1);
      expect(chatArea.children[0]).toBe(msg1);
    });

    it('splices conversation history at the retried user message', async () => {
      tabState.conversationHistory = [
        { role: 'user', content: '[ai.quotePrefix]\n\nold quote\n\nretry text' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: 'later question' },
      ];

      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);
      await retryMessage(wrapper, 'retry text', 'display', 'old quote');

      // History should be spliced from the matching user message onwards,
      // then sendToAI adds a new user message. Verify old entries are gone.
      expect(tabState.conversationHistory).not.toContainEqual(
        expect.objectContaining({ content: 'old answer' }),
      );
      expect(tabState.conversationHistory).not.toContainEqual(
        expect.objectContaining({ content: 'later question' }),
      );
    });

    it('falls back to the bubble thumbnails when the history entry was rolled back', async () => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<div class="message-user"><div class="bubble-images"><img src="data:image/png;base64,B"></div>q</div>';
      chatArea.appendChild(wrapper);

      await retryMessage(wrapper, 'q', 'q');

      const hist = tabState.conversationHistory as { content: unknown }[];
      expect(hist[hist.length - 1].content).toEqual([
        { type: 'text', text: 'q' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,B' } },
      ]);
    });

    it('calls sendToAI with the retried text and quote', async () => {
      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);

      await retryMessage(wrapper, 'raw text', 'raw display', 'raw quote');

      expect(callAI).toHaveBeenCalled();
    });

    it('clears podcast generating flag', async () => {
      tabState.isPodcastGenerating = true;

      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);
      await retryMessage(wrapper, 'text', 'display');

      expect(tabState.isPodcastGenerating).toBe(false);
    });
  });

  // ==========================================================================
  // editMessage
  // ==========================================================================
  describe('editMessage', () => {
    it('returns early when isGenerating', async () => {
      tabState.isGenerating = true;
      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);
      await editMessage(wrapper, 'orig', 'edited');
      expect(callAI).not.toHaveBeenCalled();
    });

    it('truncates history using the ORIGINAL text, not the edited text', async () => {
      tabState.conversationHistory = [
        { role: 'user', content: 'orig' },
        { role: 'assistant', content: 'old answer' },
      ];
      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);

      await editMessage(wrapper, 'orig', 'edited');

      // truncateHistoryFromUserContent must be called with the original text
      expect(truncateHistoryFromUserContent).toHaveBeenCalledWith(
        tabState,
        'orig',
        1,
      );
      // The old assistant answer must be gone (tail truncated).
      expect(tabState.conversationHistory).not.toContainEqual(
        expect.objectContaining({ content: 'old answer' }),
      );
    });

    it('truncates at the clicked message by id, even when an identical message follows', async () => {
      // The same quick action sent twice: content matching used to truncate at
      // the LAST 'summarize', leaving the first turn (whose bubble was removed)
      // in history.
      tabState.conversationHistory = [
        { id: 'u1', role: 'user', content: 'summarize' },
        { id: 'a1', role: 'assistant', content: 'first answer' },
        { id: 'u2', role: 'user', content: 'summarize' },
        { id: 'a2', role: 'assistant', content: 'second answer' },
      ];
      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);

      await retryMessage(wrapper, 'summarize', 'summarize', undefined, 'u1');

      expect(truncateHistoryFromUserContent).not.toHaveBeenCalled(); // the id path branches instead
      const contents = (tabState.conversationHistory as { content: unknown }[]).map(m => m.content);
      expect(contents).not.toContain('first answer');
      expect(contents).not.toContain('second answer');
      expect(tabState.conversationHistory).toHaveLength(1); // only the re-sent message
      expect((tabState.conversationHistory[0] as { id: string }).id).not.toBe('u1');
    });

    it('re-sends the EDITED text to the AI', async () => {
      tabState.conversationHistory = [{ role: 'user', content: 'orig' }];
      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);

      await editMessage(wrapper, 'orig', 'edited text');

      expect(callAI).toHaveBeenCalled();
      const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toBe('edited text');
    });

    it('removes all DOM messages from wrapper onwards', async () => {
      const msg1 = document.createElement('div');
      const wrapper = document.createElement('div');
      const msg2 = document.createElement('div');
      chatArea.appendChild(msg1);
      chatArea.appendChild(wrapper);
      chatArea.appendChild(msg2);

      await editMessage(wrapper, 'orig', 'edited');

      expect(chatArea.children).toHaveLength(1);
      expect(chatArea.children[0]).toBe(msg1);
    });

    it('preserves the quote when re-sending an edited quoted message', async () => {
      tabState.conversationHistory = [
        { role: 'user', content: '[ai.quotePrefix]\n\nquote\n\norig' },
      ];
      const wrapper = document.createElement('div');
      chatArea.appendChild(wrapper);

      await editMessage(wrapper, 'orig', 'edited', 'quote');

      // lookup content uses the original text + quote prefix
      expect(truncateHistoryFromUserContent).toHaveBeenCalledWith(
        tabState,
        '[ai.quotePrefix]\n\nquote\n\norig',
        1,
      );
      // the re-sent user message carries the quote prefix + edited text
      const messages = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.content).toContain('[ai.quotePrefix]');
      expect(lastMsg.content).toContain('quote');
      expect(lastMsg.content).toContain('edited');
    });
  });

  // ==========================================================================
  // sendToAI — multimodal content assembly
  // ==========================================================================
  describe('sendToAI — multimodal content', () => {
    it('builds array content with image_url blocks when images are present', async () => {
      const img1 = 'data:image/png;base64,AAA';
      const img2 = 'data:image/png;base64,BBB';

      await sendToAI('分析这些图', '分析这些图', undefined, [img1, img2]);

      const messagesArg = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const lastMsg = messagesArg[messagesArg.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toEqual([
        { type: 'text', text: '分析这些图' },
        { type: 'image_url', image_url: { url: img1 } },
        { type: 'image_url', image_url: { url: img2 } },
      ]);
      // hadImages is local bookkeeping: kept in history, never sent to the API
      expect(lastMsg.hadImages).toBeUndefined();

      // history append 收到原始带图消息（内存保留图片）
      const historyArg = (appendHistory as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(Array.isArray(historyArg.content)).toBe(true);
      expect(historyArg.hadImages).toBe(true);
    });

    it('builds string content when there are no images', async () => {
      await sendToAI('纯文字提问', '纯文字提问', undefined, []);

      const messagesArg = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const lastMsg = messagesArg[messagesArg.length - 1];
      expect(lastMsg.content).toBe('纯文字提问');
    });
  });
});
