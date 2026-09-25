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
  setGeneratingForTab: vi.fn(),
}));

// Real subscription semantics for `on` so CHAT_RERENDERED can be triggered.
const { eventHandlers } = vi.hoisted(() => ({ eventHandlers: new Map<string, Set<() => void>>() }));
vi.mock('../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  on: vi.fn((event: string, fn: () => void) => {
    if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
    eventHandlers.get(event)!.add(fn);
    return () => eventHandlers.get(event)?.delete(fn);
  }),
  EVENTS: {
    REQUEST_RERENDER: 'requestRerender',
    GENERATE_SUGGESTIONS: 'generateSuggestions',
    SAVE_CURRENT_CHAT: 'saveCurrentChat',
    CHAT_RERENDERED: 'chatRerendered',
  },
}));
function fireChatRerendered(): void {
  eventHandlers.get('chatRerendered')?.forEach(fn => fn());
}

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
  scrollToBottom: vi.fn(),
  smartScrollToBottom: vi.fn(),
  setButtonsDisabled: vi.fn(),
  // error-bubble action helpers (stop/error UX)
  addErrorMessageActions: vi.fn(),
  appendErrorMessage: vi.fn(() => document.createElement('div')),
  appendMessageFromHistory: vi.fn(() => document.createElement('div')),
  emitRetryFromWrapper: vi.fn(),
  findUserWrapperBefore: vi.fn(() => null),
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

vi.mock('../../src/side_panel/ui/markdown.js', () => ({
  renderMarkdown: vi.fn((s: string) => `<p>${s}</p>`),
}));

vi.mock('../../src/side_panel/services/agent-tools.js', () => ({
  AGENT_TOOL_SPECS: [{ name: 'search_page', description: 'd', parameters: { type: 'object' } }],
  runAgentTool: vi.fn(async () => 'tool output'),
}));

// --- Import after mocks ---
import { initStreamHandler, callAI, abortGeneration, takePendingAbort } from '../../src/side_panel/services/stream-handler.js';
import { renderMarkdown } from '../../src/side_panel/ui/markdown.js';
const marked = { parse: vi.mocked(renderMarkdown) };
import * as stateMock from '../../src/side_panel/state.js';
import * as eventsMock from '../../src/side_panel/events.js';
import * as domMock from '../../src/side_panel/ui/dom-helpers.js';
import * as ttsMock from '../../src/side_panel/services/tts/index.js';
import { runAgentTool } from '../../src/side_panel/services/agent-tools.js';

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
    // Real Chrome semantics: a port's own onDisconnect does NOT fire for a
    // disconnect() it initiated — only the other end sees it.
    disconnect: vi.fn(),
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
    stateMock.setGeneratingForTab.mockImplementation((_id: number, v: boolean) => { tabState.isGenerating = v; });

    // Set up chrome.runtime.connect to return our mock port
    port = createMockPort();
    globalThis.chrome = {
      runtime: { connect: vi.fn(() => port) },
    } as unknown as typeof chrome;

    initStreamHandler({ chatArea: document.createElement('div') });
  });

  describe('agent mode', () => {
    it('offers the tools, runs requested calls in the panel and returns the results', async () => {
      await callAI([{ role: 'user', content: 'q' }], 1, { agent: true });
      expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'agent', tools: expect.any(Array) }));

      port._simulateMessage({ type: 'tool_calls', calls: [{ id: 'c1', name: 'search_page', arguments: '{"query":"x"}' }], assistant: { role: 'assistant', content: '' } });
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({
        type: 'tool_results', results: [{ tool_call_id: 'c1', name: 'search_page', content: 'tool output' }],
      }));
      expect(runAgentTool).toHaveBeenCalledWith('search_page', '{"query":"x"}', 1);
    });

    it('a plain chat does not offer tools', async () => {
      await callAI([], 1);
      expect(port.postMessage).toHaveBeenCalledWith({ type: 'chat', messages: [] });
    });
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
    expect(stateMock.setGeneratingForTab).toHaveBeenCalledWith(1, true);
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
      // First token flushes immediately...
      expect(marked.parse).toHaveBeenCalledWith('Let me think');
      expect(domMock.removeTypingIndicator).toHaveBeenCalled();

      // ...later tokens buffer (throttled) until the final flush on done
      port._simulateMessage({ type: 'thinking', content: ' more' });
      expect(marked.parse).not.toHaveBeenCalledWith('Let me think more');
      port._simulateMessage({ type: 'done' });
      expect(marked.parse).toHaveBeenLastCalledWith('Let me think more');
    });

    it('shows elapsed time from first thinking token to first answer chunk', async () => {
      const nowSpy = vi.spyOn(globalThis.performance, 'now');
      nowSpy.mockReturnValue(1000);
      await callAI([], 1);

      port._simulateMessage({ type: 'thinking', content: 'Reasoning' });
      expect(document.querySelector('.thinking-summary')?.textContent).toBe('[ai.thinking]');

      nowSpy.mockReturnValue(3456);
      port._simulateMessage({ type: 'chunk', content: 'Answer' });

      expect(document.querySelector('.thinking-summary')?.textContent).toBe('[ai.thinking] · 2.5s');
      nowSpy.mockRestore();
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
      port._simulateMessage({ type: 'done' });

      expect(domMock.removeTypingIndicator).toHaveBeenCalled();
      // Stream path delegates exclusively to the smart (stick-aware) variant —
      // the old forced first-flush scroll was removed with the stick-to-bottom
      // state machine (see ui/auto-scroll.ts).
      expect(domMock.smartScrollToBottom).toHaveBeenCalled();
      expect(domMock.scrollToBottom).not.toHaveBeenCalled();
    });

    it('never force-scrolls during a stream — respects a reader scrolled up during thinking', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'thinking', content: 'hmm' });
      port._simulateMessage({ type: 'chunk', content: 'answer' });
      port._simulateMessage({ type: 'done' });

      expect(domMock.scrollToBottom).not.toHaveBeenCalled();
      expect(domMock.smartScrollToBottom).toHaveBeenCalled();
    });

    it('makes no DOM or scroll calls while the thinking block is collapsed by the user', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        document.body.innerHTML = ''; // isolate from other tests' leftover DOM
        await callAI([], 1);

        port._simulateMessage({ type: 'thinking', content: 'visible token' }); // immediate flush
        const details = document.querySelector('.thinking-block') as HTMLDetailsElement;
        expect(details).toBeTruthy();
        details.open = false; // user collapsed mid-thinking

        marked.parse.mockClear();
        domMock.smartScrollToBottom.mockClear();
        domMock.scrollToBottom.mockClear();

        port._simulateMessage({ type: 'thinking', content: ' hidden token' }); // buffered
        vi.advanceTimersByTime(200); // pending flush fires with the box closed

        // flushNow skips flushThinking entirely when details is closed — no
        // innerHTML rebuild, no scroll write, nothing for the user to fight.
        expect(marked.parse).not.toHaveBeenCalled();
        expect(domMock.smartScrollToBottom).not.toHaveBeenCalled();
        expect(domMock.scrollToBottom).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
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
        id: expect.any(String),
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

    it('attaches a settings action for config errors (noApiKey)', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'error', errorKey: 'error.noApiKey' });

      expect(domMock.addErrorMessageActions).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ label: '[action.openSettings]' }),
        ]),
      );
    });

    it('attaches no settings action for non-config errors', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'error', error: 'boom' });

      const actions = (domMock.addErrorMessageActions as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(actions.filter((a: { label: string }) => a.label === '[action.openSettings]')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // user abort (stop button)
  // ==========================================================================
  describe('user abort', () => {
    it('finalizes the partial answer into history when aborted by the user', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'chunk', content: 'partial answer' });

      abortGeneration(1); // disconnects the port with the user-abort flag set

      expect(tabState.conversationHistory).toContainEqual({
        id: expect.any(String),
        role: 'assistant',
        content: 'partial answer',
      });
      expect(tabState.isGenerating).toBe(false);
      expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(false);
      expect(eventsMock.emit).toHaveBeenCalledWith('saveCurrentChat');
    });

    it('finalizes on Stop even though the port\'s own onDisconnect never fires', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'chunk', content: 'partial' });

      abortGeneration(1);

      expect(port.disconnect).toHaveBeenCalled();
      expect(tabState.isGenerating).toBe(false);
      // a second abort is a no-op (stream already finalized)
      abortGeneration(1);
      expect(tabState.conversationHistory).toHaveLength(1);
    });

    it('Stop before any answer text: drops the turn and shows a note, not an error', async () => {
      tabState.conversationHistory = [{ role: 'user', content: 'q' }];
      await callAI([], 1);
      const msgEl = (domMock.appendMessage as ReturnType<typeof vi.fn>).mock.results[0].value as HTMLElement;

      abortGeneration(1);

      expect(tabState.conversationHistory).toHaveLength(0);
      expect(tabState.isGenerating).toBe(false);
      expect(msgEl.className).toBe('message message-note');
      expect(msgEl.textContent).toBe('[ai.stopped]');
      expect(domMock.setButtonsDisabled).toHaveBeenCalledWith(false);
    });

    it('a Stop before the stream opens is remembered for sendToAI to pick up', () => {
      tabState.isGenerating = true; // sendToAI is still extracting the page
      abortGeneration(1);
      expect(takePendingAbort(1)).toBe(true);
      expect(takePendingAbort(1)).toBe(false); // consumed once
    });

    it('does not touch history when generation is still pending (no content yet)', async () => {
      await callAI([], 1);
      port._simulateDisconnect(); // unexpected disconnect, nothing streamed

      expect(tabState.conversationHistory).toHaveLength(0);
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
      expect(stateMock.setGeneratingForTab).toHaveBeenLastCalledWith(1, false);
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
  // stream render throttling
  // ==========================================================================
  describe('stream render throttling', () => {
    it('flushes the first chunk immediately and buffers subsequent chunks until the interval elapses', async () => {
      // Fake only timers — performance.now stays real, which is fine because
      // the buffered messages are simulated synchronously (elapsed ≈ 0ms).
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await callAI([], 1);

        port._simulateMessage({ type: 'chunk', content: 'Hello' });
        expect(marked.parse).toHaveBeenCalledTimes(1);

        port._simulateMessage({ type: 'chunk', content: ' world' });
        port._simulateMessage({ type: 'chunk', content: '!' });
        expect(marked.parse).toHaveBeenCalledTimes(1); // still buffered

        vi.advanceTimersByTime(100);
        expect(marked.parse).toHaveBeenCalledTimes(2);
        expect(marked.parse).toHaveBeenLastCalledWith('Hello world!');
      } finally {
        vi.useRealTimers();
      }
    });

    it('performs a final flush on done with the full text', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'chunk', content: 'par' });
      port._simulateMessage({ type: 'chunk', content: 'tial answer' });
      port._simulateMessage({ type: 'done' });

      expect(marked.parse).toHaveBeenLastCalledWith('partial answer');
    });

    it('closes an unterminated code fence before parsing', async () => {
      await callAI([], 1);

      port._simulateMessage({ type: 'chunk', content: 'text\n```js\nconst a = 1;' });
      // one ``` marker → odd → balanced with a closing fence
      expect(marked.parse).toHaveBeenLastCalledWith('text\n```js\nconst a = 1;\n```');

      // two ``` markers → even → text parsed as-is
      port._simulateMessage({ type: 'chunk', content: '\n```' });
      expect(marked.parse).toHaveBeenLastCalledWith('text\n```js\nconst a = 1;\n```');
    });

    it('does not flush after an error cancels the pending flush', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await callAI([], 1);

        port._simulateMessage({ type: 'chunk', content: 'Hello' }); // immediate flush
        marked.parse.mockClear();

        port._simulateMessage({ type: 'chunk', content: ' world' }); // buffered
        port._simulateMessage({ type: 'error', error: 'boom' });

        vi.advanceTimersByTime(200);
        expect(marked.parse).not.toHaveBeenCalled(); // canceled with the error path
      } finally {
        vi.useRealTimers();
      }
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
        id: expect.any(String),
        role: 'assistant',
        content: 'response',
      });
    });
  });

  // ==========================================================================
  // background tabs: re-attach / deferred save / deferred error
  // ==========================================================================
  describe('background tab lifecycle', () => {
    it('keeps the thinking block open once the user re-opens it mid-answer', async () => {
      await callAI([], 1);
      port._simulateMessage({ type: 'thinking', content: 'hmm' });
      port._simulateMessage({ type: 'chunk', content: 'a' });
      const details = document.body.querySelector('details.thinking-block') as HTMLDetailsElement;
      expect(details.open).toBe(false);

      details.open = true; // user re-opens
      port._simulateMessage({ type: 'chunk', content: 'b' });
      expect(details.open).toBe(true);
    });

    it('re-attaches the live answer bubble when the user returns to the tab', async () => {
      const chatArea = document.createElement('div');
      document.body.appendChild(chatArea);
      initStreamHandler({ chatArea });
      await callAI([], 1);
      const msgEl = (domMock.appendMessage as ReturnType<typeof vi.fn>).mock.results[0].value as HTMLElement;

      // switch away: the chat area is rebuilt for tab 2, detaching the bubble
      stateMock.getActiveTabId.mockReturnValue(2);
      msgEl.remove();
      port._simulateMessage({ type: 'chunk', content: 'streamed while away' });

      // back to tab 1: rebuilt from history, then CHAT_RERENDERED
      stateMock.getActiveTabId.mockReturnValue(1);
      fireChatRerendered();

      expect(chatArea.contains(msgEl)).toBe(true);
      expect(msgEl.textContent).toContain('streamed while away');
    });

    it('saves an answer that finished in the background once the tab is shown again', async () => {
      await callAI([], 1);
      stateMock.getActiveTabId.mockReturnValue(2);
      port._simulateMessage({ type: 'chunk', content: 'answer' });
      port._simulateMessage({ type: 'done' });
      expect(eventsMock.emit).not.toHaveBeenCalledWith('saveCurrentChat');

      stateMock.getActiveTabId.mockReturnValue(1);
      fireChatRerendered();
      expect(eventsMock.emit).toHaveBeenCalledWith('saveCurrentChat');
    });

    it('shows a background failure (and the failed message) on return', async () => {
      const failed = { role: 'user', content: 'q' };
      tabState.conversationHistory = [failed];
      await callAI([], 1);
      stateMock.getActiveTabId.mockReturnValue(2);
      port._simulateMessage({ type: 'error', error: 'boom' });
      expect(tabState.conversationHistory).toHaveLength(0);

      stateMock.getActiveTabId.mockReturnValue(1);
      fireChatRerendered();
      expect(domMock.appendMessageFromHistory).toHaveBeenCalledWith(failed);
      expect(domMock.appendErrorMessage).toHaveBeenCalledWith('boom', expect.any(Array));
    });
  });
});
