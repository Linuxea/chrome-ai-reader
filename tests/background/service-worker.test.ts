/**
 * Tests for background/service-worker.ts — the central message/port router.
 *
 * The SW registers chrome.action.onClicked, chrome.runtime.onConnect, and
 * chrome.runtime.onMessage listeners at MODULE LOAD time. This means the
 * chrome mock must be on globalThis BEFORE the import — hence vi.hoisted.
 *
 * Test strategy: capture the listeners during import, then invoke them
 * with test-crafted messages/ports to verify routing.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- vi.hoisted: set up chrome mock BEFORE service-worker import ---
// service-worker.ts calls chrome.action.onClicked.addListener etc. at top level.
const {
  onConnectListener,
  onMessageListener,
  onClickedListener,
  chromeSendMessage,
} = vi.hoisted(() => {
  let _onConnect: ((port: { name: string; onMessage: { addListener: (fn: (...args: unknown[]) => void) => void } }) => void) | null = null;
  let _onMessage: ((msg: Record<string, unknown>, sender: { tab?: { id?: number } }, sendResponse: (r?: unknown) => void) => unknown | true) | null = null;
  let _onClicked: ((tab: { id?: number }) => void) | null = null;
  const _sendMessage = vi.fn(() => Promise.resolve());

  globalThis.chrome = {
    action: {
      onClicked: {
        addListener: vi.fn((fn: (tab: { id?: number }) => void) => { _onClicked = fn; }),
      },
    },
    sidePanel: {
      open: vi.fn(),
    },
    runtime: {
      onConnect: {
        addListener: vi.fn((fn: typeof _onConnect) => { _onConnect = fn; }),
      },
      onMessage: {
        addListener: vi.fn((fn: typeof _onMessage) => { _onMessage = fn; }),
      },
      // service-worker forwards selectionChanged via runtime.sendMessage
      sendMessage: _sendMessage,
    },
    tabs: {},
    storage: {},
  } as unknown as typeof chrome;

  return {
    onConnectListener: () => _onConnect,
    onMessageListener: () => _onMessage,
    onClickedListener: () => _onClicked,
    chromeSendMessage: _sendMessage,
  };
});

// --- Mock all handler modules so we can verify routing ---
vi.mock('../../src/background/sw-openai.js', () => ({
  callOpenAI: vi.fn(),
  callSuggestQuestions: vi.fn(),
  callEmbedding: vi.fn(),
}));
vi.mock('../../src/background/sw-tts.js', () => ({ callTTS: vi.fn() }));
vi.mock('../../src/background/sw-podcast.js', () => ({ callPodcast: vi.fn() }));
vi.mock('../../src/background/sw-ocr.js', () => ({
  handleOcrParse: vi.fn(() => true),
}));
vi.mock('../../src/background/sw-related-pages.js', () => ({
  handlePageRecordsMessage: vi.fn((msg: Record<string, unknown>, sendResponse: (r?: unknown) => void) => {
    sendResponse({ success: true });
    return true;
  }),
}));

// --- Import after mocks are set up ---
import '../../src/background/service-worker.js';
import { callOpenAI, callSuggestQuestions, callEmbedding } from '../../src/background/sw-openai.js';
import { callTTS } from '../../src/background/sw-tts.js';
import { callPodcast } from '../../src/background/sw-podcast.js';
import { handleOcrParse } from '../../src/background/sw-ocr.js';
import { handlePageRecordsMessage } from '../../src/background/sw-related-pages.js';

// --- Helper: create a mock port for onConnect tests ---
function createMockPortForRoute(name: string) {
  const messageListeners: ((msg: Record<string, unknown>) => void)[] = [];
  return {
    name,
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: (msg: Record<string, unknown>) => void) => messageListeners.push(fn)),
    },
    onDisconnect: { addListener: vi.fn() },
    /** Test-only: simulate the SW receiving a message on this port */
    _receiveMessage(msg: Record<string, unknown>) {
      messageListeners.forEach(fn => fn(msg));
    },
  };
}

describe('background/service-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // action.onClicked
  // ==========================================================================
  describe('chrome.action.onClicked', () => {
    it('opens the side panel when extension icon is clicked', () => {
      const listener = onClickedListener();
      listener!({ id: 42 });
      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
    });
  });

  // ==========================================================================
  // runtime.onConnect — port routing
  // ==========================================================================
  describe('chrome.runtime.onConnect routing', () => {
    it('routes ai-chat port to callOpenAI on "chat" message', async () => {
      const port = createMockPortForRoute('ai-chat');
      onConnectListener()!(port);

      const messages = [{ role: 'user', content: 'hello' }];
      port._receiveMessage({ type: 'chat', messages });

      // The listener is async — wait for the microtask
      await vi.waitFor(() => expect(callOpenAI).toHaveBeenCalled());
      expect(callOpenAI).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({ name: 'ai-chat' }),
        expect.objectContaining({ response_format: undefined }),
      );
    });

    it('passes response_format to callOpenAI when provided', async () => {
      const port = createMockPortForRoute('ai-chat');
      onConnectListener()!(port);

      const response_format = { type: 'json_object' };
      port._receiveMessage({ type: 'chat', messages: [], response_format });

      await vi.waitFor(() => expect(callOpenAI).toHaveBeenCalled());
      expect(callOpenAI).toHaveBeenCalledWith(
        [],
        expect.anything(),
        expect.objectContaining({ response_format }),
      );
    });

    it('routes tts port to callTTS on "tts" message', async () => {
      const port = createMockPortForRoute('tts');
      onConnectListener()!(port);
      port._receiveMessage({ type: 'tts', text: 'hello world' });

      await vi.waitFor(() => expect(callTTS).toHaveBeenCalled());
      expect(callTTS).toHaveBeenCalledWith('hello world', expect.objectContaining({ name: 'tts' }));
    });

    it('routes tts-download port to callTTS (shared handler)', async () => {
      const port = createMockPortForRoute('tts-download');
      onConnectListener()!(port);
      port._receiveMessage({ type: 'tts', text: 'download me' });

      await vi.waitFor(() => expect(callTTS).toHaveBeenCalled());
    });

    it('routes suggest-questions port to callSuggestQuestions', async () => {
      const port = createMockPortForRoute('suggest-questions');
      onConnectListener()!(port);

      const messages = [{ role: 'assistant', content: 'response' }];
      port._receiveMessage({ type: 'suggest', messages });

      await vi.waitFor(() => expect(callSuggestQuestions).toHaveBeenCalled());
      expect(callSuggestQuestions).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({ name: 'suggest-questions' }),
      );
    });

    it('routes podcast-llm port to callOpenAI with json_object format', async () => {
      const port = createMockPortForRoute('podcast-llm');
      onConnectListener()!(port);
      port._receiveMessage({ type: 'generate', prompt: 'sys', text: 'content' });

      await vi.waitFor(() => expect(callOpenAI).toHaveBeenCalled());
      expect(callOpenAI).toHaveBeenCalledWith(
        [{ role: 'user', content: 'sys\n\ncontent' }],
        expect.objectContaining({ name: 'podcast-llm' }),
        expect.objectContaining({ response_format: { type: 'json_object' } }),
      );
    });

    it('routes podcast-audio port to callPodcast', async () => {
      const port = createMockPortForRoute('podcast-audio');
      onConnectListener()!(port);

      const nlpTexts = [{ speaker: 'A', text: 'hi' }];
      const audioConfig = { format: 'mp3', sample_rate: 24000, speech_rate: 1 };
      port._receiveMessage({ type: 'generate', nlpTexts, audioConfig });

      await vi.waitFor(() => expect(callPodcast).toHaveBeenCalled());
      expect(callPodcast).toHaveBeenCalledWith(
        nlpTexts,
        audioConfig,
        expect.objectContaining({ name: 'podcast-audio' }),
      );
    });

    it('routes embedding port to callEmbedding', async () => {
      const port = createMockPortForRoute('embedding');
      onConnectListener()!(port);
      port._receiveMessage({ type: 'embed', text: 'embed me' });

      await vi.waitFor(() => expect(callEmbedding).toHaveBeenCalled());
      expect(callEmbedding).toHaveBeenCalledWith(
        'embed me',
        expect.objectContaining({ name: 'embedding' }),
      );
    });

    it('ignores non-matching message types on ai-chat port', async () => {
      const port = createMockPortForRoute('ai-chat');
      onConnectListener()!(port);
      port._receiveMessage({ type: 'unknown' });
      // Give async handlers time to run
      await new Promise(r => setTimeout(r, 10));
      expect(callOpenAI).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // runtime.onMessage — one-shot message routing
  // ==========================================================================
  describe('chrome.runtime.onMessage routing', () => {
    it('forwards selectionChanged messages (with forwarded flag to prevent loops)', () => {
      const sendResponse = vi.fn();
      onMessageListener()!(
        { action: 'selectionChanged', text: 'selected text' },
        { tab: { id: 99 } },
        sendResponse,
      );

      expect(chromeSendMessage).toHaveBeenCalledWith({
        action: 'selectionChanged',
        text: 'selected text',
        tabId: 99,
        forwarded: true,
      });
    });

    it('does NOT re-forward already-forwarded selectionChanged messages', () => {
      onMessageListener()!(
        { action: 'selectionChanged', text: 'text', forwarded: true },
        { tab: { id: 99 } },
        vi.fn(),
      );
      expect(chromeSendMessage).not.toHaveBeenCalled();
    });

    it('fetches models from API on fetchModels action', async () => {
      const mockModels = [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockModels }),
      } as Response);

      const sendResponse = vi.fn();
      const result = onMessageListener()!(
        { action: 'fetchModels', apiBase: 'https://api.test.com', apiKey: 'sk-test' },
        {},
        sendResponse,
      );

      expect(result).toBe(true); // async response

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/models',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer sk-test' },
        }),
      );
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        models: ['gpt-4', 'gpt-3.5-turbo'],
      });
    });

    it('uses default DeepSeek API base when not specified', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      } as Response);

      const sendResponse = vi.fn();
      onMessageListener()!(
        { action: 'fetchModels', apiKey: 'sk-test' },
        {},
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(fetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/models',
        expect.anything(),
      );
    });

    it('handles fetchModels failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const sendResponse = vi.fn();
      onMessageListener()!(
        { action: 'fetchModels', apiKey: 'bad' },
        {},
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('401'),
        }),
      );
    });

    it('routes ocrParse to handleOcrParse', () => {
      const sendResponse = vi.fn();
      const result = onMessageListener()!(
        { action: 'ocrParse', file: 'data:image/png;base64,abc' },
        {},
        sendResponse,
      );
      expect(result).toBe(true);
      expect(handleOcrParse).toHaveBeenCalled();
    });

    it('routes pageRecords:store to handlePageRecordsMessage', () => {
      const sendResponse = vi.fn();
      const result = onMessageListener()!(
        { action: 'pageRecords:store', record: {}, maxPages: 200 },
        {},
        sendResponse,
      );
      expect(result).toBe(true);
      expect(handlePageRecordsMessage).toHaveBeenCalled();
    });

    it('routes pageRecords:findRelated to handlePageRecordsMessage', () => {
      const sendResponse = vi.fn();
      const result = onMessageListener()!(
        { action: 'pageRecords:findRelated', normalizedUrl: 'https://a.com', threshold: 0.7, limit: 5 },
        {},
        sendResponse,
      );
      expect(result).toBe(true);
      expect(handlePageRecordsMessage).toHaveBeenCalled();
    });
  });
});
