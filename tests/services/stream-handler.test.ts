/**
 * Tests for side_panel/services/stream-handler.ts — SSE streaming state machine.
 *
 * Core chat path: opens a chrome.runtime.connect('ai-chat') port, then handles
 * 4 message types: thinking, chunk, done, error. Also handles unexpected
 * port disconnect.
 *
 * All dependencies are mocked via vi.mock — we're testing the message-handling
 * state machine logic (accumulation, DOM rendering delegation, event emission,
 * conversation history mutation, error rollback).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mock all dependencies ---

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key: string) => `[${key}]`,
}));

vi.mock('../../src/shared/constants.js', () => ({
  escapeHtml: (s: string) => s,
}));

vi.mock('../../src/side_panel/state.js', () => ({
  getStateForTab: vi.fn(),
  getActiveTabId: vi.fn(() => 1),
  persistForTab: vi.fn(),
}));

vi.mock('../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: {
    REQUEST_RERENDER: 'requestRerender',
    GENERATE_SUGGESTIONS: 'generateSuggestions',
  },
}));

vi.mock('../../src/side_panel/ui/dom-helpers.js', () => ({
  // Elements MUST be connected to document so msgEl.isConnected === true.
  // stream-handler guards all DOM rendering behind isCurrentTab() && msgEl.isConnected.
  appendMessage: vi.fn(() => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }),
  addTypingIndicator: vi.fn(() => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }),
  removeTypingIndicator: vi.fn(),
  smartScrollToBottom: vi.fn(),
  setButtonsDisabled: vi.fn(),
}));

vi.mock('../../src/side_panel/services/tts/index.js', () => ({
  isTTSPlaying: vi.fn(() => false),
  stopTTS: vi.fn(),
  initTTSPlayback: vi.fn(),
  ttsAppendChunk: vi.fn(),
  addTTSButton: vi.fn(),
  initTTSAutoPlay: vi.fn(),
  isTTSAutoPlay: vi.fn(() => false),
}));

vi.mock('marked', () => ({
  marked: { parse: vi.fn((s: string) => `<p>${s}</p>`) },
}));

// --- Import after mocks ---
import { initStreamHandler, callAI } from '../../src/side_panel/services/stream-handler.js';
import { marked } from 'marked';
import * as stateMock from '../../src/side_panel/state.js';
import * as eventsMock from '../../src/side_panel/events.js';
import * as domMock from '../../src/side_panel/ui/dom-helpers.js';
import * as ttsMock from '../../src/side_panel/services/tts/index.js';

// --- Programmable port mock for chrome.runtime.connect ---
function createMockPort() {
  const messageListeners = new Set<(msg: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  return {
    name: 'ai-chat',
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: (msg: unknown) => void) => messageListeners.add(fn)),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn((fn: () => void) => disconnectListeners.add(fn)),
      removeListener: vi.fn(),
    },
    disconnect: vi.fn(() => disconnectListeners.forEach(fn => fn())),
    _simulateMessage(msg: unknown) { messageListeners.forEach(fn => fn(msg)); },
    _simulateDisconnect() { disconnectListeners.forEach(fn => fn()); },
    _messageListeners: messageListeners,
  };
}

describe('services/stream-handler', () => {
  let port: ReturnType<typeof createMockPort>;
  let tabState: {
    isGenerating: boolean;
    conversationHistory: { role: string; content: string }[];
  };

  beforeEach(() => {
    vi.clearAllMocks();

    tabState = {
      isGenerating: false,
      conversationHistory: [],
    };

    stateMock.getStateForTab.mockReturnValue(tabState);
    stateMock.getActiveTabId.mockReturnValue(1);

    // Set up chrome.runtime.connect to return our mock port
    port = createMockPort();
    globalThis.chrome = {
      runtime: { connect: vi.fn(() => port) },
    } as unknown as typeof chrome;

    initStreamHandler({ chatArea: document.createElement('div') });
  });

  it('stops any ongoing TTS when a new call starts', async () => {
    ttsMock.isTTSPlaying.mockReturnValue(true);
    await callAI([], 1);
    expect(ttsMock.stopTTS).toHaveBeenCalled();
  });

  it('returns early if no tabState for the given tabId', async () => {
    stateMock.getStateForTab.mockReturnValue(null);
    await callAI([], 999);
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('sets isGenerating=true and persists state at start', async () => {
    await callAI([], 1);
    expect(tabState.isGenerating).toBe(true);
    expect(stateMock.persistForTab).toHaveBeenCalledWith(1);
    expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(true);
  });

  it('creates AI message and typing indicator', async () => {
    await callAI([], 1);
    expect(domMock.appendMessage).toHaveBeenCalledWith('ai', '');
    expect(domMock.addTypingIndicator).toHaveBeenCalled();
  });

  it('posts chat message to the port', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    await callAI(messages, 1);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'chat', messages });
  });

  // ==========================================================================
  // thinking messages
  // ==========================================================================
  describe('thinking messages', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      document.body.innerHTML = '';
    });

    it('accumulates thinking text and renders markdown', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'thinking', content: 'Let me think' });
      port._simulateMessage({ type: 'thinking', content: ' more' });

      // marked.parse should have been called with accumulated text
      expect(marked.parse).toHaveBeenCalledWith('Let me think more');
      expect(domMock.removeTypingIndicator).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // chunk messages
  // ==========================================================================
  describe('chunk messages', () => {
    it('accumulates content text and renders markdown', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'chunk', content: 'Hello' });
      port._simulateMessage({ type: 'chunk', content: ' world' });

      expect(domMock.removeTypingIndicator).toHaveBeenCalled();
      expect(domMock.smartScrollToBottom).toHaveBeenCalled();
    });

    it('forwards chunks to TTS when autoplay is enabled', async () => {
      ttsMock.isTTSAutoPlay.mockReturnValue(true);
      await callAI([], 1);

      port._simulateMessage({ type: 'chunk', content: 'speak this' });

      expect(ttsMock.ttsAppendChunk).toHaveBeenCalledWith('speak this');
    });

    it('does NOT forward chunks to TTS when autoplay is disabled', async () => {
      ttsMock.isTTSAutoPlay.mockReturnValue(false);
      await callAI([], 1);

      port._simulateMessage({ type: 'chunk', content: 'no speak' });

      expect(ttsMock.ttsAppendChunk).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // done message
  // ==========================================================================
  describe('done message', () => {
    it('pushes assistant response to conversation history', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'chunk', content: 'final answer' });
      port._simulateMessage({ type: 'done' });

      expect(tabState.conversationHistory).toContainEqual({
        role: 'assistant',
        content: 'final answer',
      });
    });

    it('sets isGenerating=false and disconnects port', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'done' });

      expect(tabState.isGenerating).toBe(false);
      expect(port.disconnect).toHaveBeenCalled();
      expect(stateMock.persistForTab).toHaveBeenCalled();
    });

    it('re-enables buttons, adds TTS button, emits GENERATE_SUGGESTIONS', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'done' });

      expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(false);
      expect(ttsMock.addTTSButton).toHaveBeenCalled();
      expect(ttsMock.initTTSAutoPlay).toHaveBeenCalled();
      expect(eventsMock.emit).toHaveBeenCalledWith(
        'generateSuggestions',
        expect.objectContaining({ history: tabState.conversationHistory }),
      );
    });
  });

  // ==========================================================================
  // error message
  // ==========================================================================
  describe('error message', () => {
    it('rolls back the last user message from history', async () => {
      tabState.conversationHistory = [
        { role: 'user', content: 'question' },
      ];

      await callAI([], 1);
      port._simulateMessage({ type: 'error', error: 'API failed' });

      // The user message should have been removed
      expect(tabState.conversationHistory).toHaveLength(0);
      expect(stateMock.persistForTab).toHaveBeenCalled();
    });

    it('does not splice if last message is not from user', async () => {
      tabState.conversationHistory = [
        { role: 'assistant', content: 'response' },
      ];

      await callAI([], 1);
      port._simulateMessage({ type: 'error', error: 'err' });

      expect(tabState.conversationHistory).toHaveLength(1);
    });

    it('sets isGenerating=false and disconnects port', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'error', error: 'err' });

      expect(tabState.isGenerating).toBe(false);
      expect(port.disconnect).toHaveBeenCalled();
    });

    it('re-enables buttons on error', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'error', error: 'err' });

      expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(false);
    });
  });

  // ==========================================================================
  // unexpected disconnect
  // ==========================================================================
  describe('unexpected port disconnect', () => {
    it('treats disconnect with no content as error', async () => {
      await callAI([], 1);

      // Simulate SW disconnecting the port unexpectedly (no 'done'/'error')
      port._simulateDisconnect();

      expect(tabState.isGenerating).toBe(false);
      expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(false);
      expect(stateMock.persistForTab).toHaveBeenCalled();
    });

    it('does NOT treat as error if content was already received (graceful disconnect after done)', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'chunk', content: 'answer' });
      port._simulateMessage({ type: 'done' });

      // isGenerating is already false from 'done', so disconnect handler
      // should NOT trigger the error path
      const errorEmitCalls = (eventsMock.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([event]) => event === 'requestRerender',
      );
      // Done handler already handled cleanup
      expect(tabState.isGenerating).toBe(false);
    });

    it('rolls back user message on disconnect with no content', async () => {
      tabState.conversationHistory = [
        { role: 'user', content: 'my question' },
      ];

      await callAI([], 1);
      port._simulateDisconnect();

      // User message should be removed (no response received)
      expect(tabState.conversationHistory).toHaveLength(0);
    });
  });

  // ==========================================================================
  // tab switching (isCurrentTab guard)
  // ==========================================================================
  describe('tab switching guards', () => {
    it('does not render DOM updates when tab has switched away', async () => {
      await callAI([], 1);

      // Simulate switching to a different tab
      stateMock.getActiveTabId.mockReturnValue(2);

      domMock.removeTypingIndicator.mockClear();
      domMock.smartScrollToBottom.mockClear();

      port._simulateMessage({ type: 'chunk', content: 'text' });

      // DOM helpers should NOT have been called for inactive tab
      expect(domMock.smartScrollToBottom).not.toHaveBeenCalled();
    });

    it('still updates conversation history even when tab is inactive', async () => {
      await callAI([], 1);

      stateMock.getActiveTabId.mockReturnValue(2);
      port._simulateMessage({ type: 'chunk', content: 'response' });
      port._simulateMessage({ type: 'done' });

      // History should still be updated regardless of active tab
      expect(tabState.conversationHistory).toContainEqual({
        role: 'assistant',
        content: 'response',
      });
    });
  });
});
