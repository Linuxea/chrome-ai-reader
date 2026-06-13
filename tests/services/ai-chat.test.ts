/**
 * Tests for side_panel/services/ai-chat.ts — chat facade + keyboard routing.
 *
 * Primary test target: handleKeydown (private, tested via event simulation).
 * Keyboard logic routes ArrowUp/Down/Enter/Escape through the command popup
 * state, and Enter (without shift) sends the message.
 *
 * Also verifies initAIChat wires up event listeners and sub-module inits.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mock all sub-modules to verify init wiring ---
vi.mock('../../src/side_panel/services/stream-handler.js', () => ({
  initStreamHandler: vi.fn(),
}));
vi.mock('../../src/side_panel/services/quick-action-handler.js', () => ({
  initQuickActionHandler: vi.fn(),
  handleQuickAction: vi.fn(),
}));
vi.mock('../../src/side_panel/services/message-sender.js', () => ({
  initMessageSender: vi.fn(),
  sendToAI: vi.fn(),
  sendMessage: vi.fn(),
  retryMessage: vi.fn(),
  extractPageContent: vi.fn(),
}));
// page-extractor must be mocked too — it imports state.ts which registers
// chrome.tabs.onRemoved.addListener at module load time
vi.mock('../../src/side_panel/services/page-extractor.js', () => ({
  extractPageContent: vi.fn(),
}));

// --- Import after mocks ---
import { initAIChat, sendToAI, sendMessage, retryMessage, extractPageContent } from '../../src/side_panel/services/ai-chat.js';
import { initStreamHandler } from '../../src/side_panel/services/stream-handler.js';
import { initQuickActionHandler, handleQuickAction } from '../../src/side_panel/services/quick-action-handler.js';
import { initMessageSender } from '../../src/side_panel/services/message-sender.js';

/**
 * Build a minimal set of AIChatDeps for testing.
 * All command-popup functions are vi.fn so we can assert calls.
 */
function createDeps() {
  const userInput = document.createElement('textarea');
  const sendBtn = document.createElement('button');
  // actionBtns must be a NodeList — use querySelectorAll on a temp container
  const btnContainer = document.createElement('div');
  btnContainer.innerHTML = '<button data-action="summarize"></button><button data-action="translate"></button>';
  const actionBtns = btnContainer.querySelectorAll('button');

  return {
    chatArea: document.createElement('div'),
    userInput,
    sendBtn,
    actionBtns,
    isCommandPopupOpen: vi.fn(() => false),
    getFilteredCommands: vi.fn(() => []),
    renderCommandPopup: vi.fn(),
    hideCommandPopup: vi.fn(),
    executeQuickCommand: vi.fn(),
    getCommandSelectedIndex: vi.fn(() => 0),
    setCommandSelectedIndex: vi.fn(),
  };
}

/**
 * Dispatch a keydown event on the textarea and return a promise
 * to flush any async handlers.
 */
function pressKey(target: HTMLElement, key: string, opts: { shiftKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: opts.shiftKey ?? false,
  });
  target.dispatchEvent(event);
  return event;
}

describe('services/ai-chat', () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    deps = createDeps();
  });

  // ==========================================================================
  // initAIChat — wiring
  // ==========================================================================
  describe('initAIChat wiring', () => {
    it('calls initStreamHandler, initMessageSender, initQuickActionHandler', () => {
      initAIChat(deps);

      expect(initStreamHandler).toHaveBeenCalledWith({ chatArea: deps.chatArea });
      expect(initMessageSender).toHaveBeenCalledWith({
        chatArea: deps.chatArea,
        userInput: deps.userInput,
      });
      expect(initQuickActionHandler).toHaveBeenCalledWith(expect.objectContaining({ sendToAI }));
    });

    it('attaches click listener to send button', () => {
      initAIChat(deps);
      deps.sendBtn.click();
      expect(sendMessage).toHaveBeenCalled();
    });

    it('attaches click listeners to action buttons', () => {
      initAIChat(deps);
      const firstAction = deps.actionBtns[0];
      firstAction.click();
      expect(handleQuickAction).toHaveBeenCalledWith('summarize');
    });
  });

  // ==========================================================================
  // handleKeydown — command popup navigation (popup open)
  // ==========================================================================
  describe('keydown: command popup navigation', () => {
    beforeEach(() => {
      initAIChat(deps);
    });

    it('ArrowDown increments selected index (wraps around)', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);
      deps.getFilteredCommands.mockReturnValue([
        { name: 'cmd1', prompt: 'p1' },
        { name: 'cmd2', prompt: 'p2' },
        { name: 'cmd3', prompt: 'p3' },
      ]);
      deps.getCommandSelectedIndex.mockReturnValue(0);

      const event = pressKey(deps.userInput, 'ArrowDown');

      expect(event.defaultPrevented).toBe(true);
      expect(deps.setCommandSelectedIndex).toHaveBeenCalledWith(1); // 0→1
      expect(deps.renderCommandPopup).toHaveBeenCalled();
    });

    it('ArrowDown wraps from last to first', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);
      const cmds = [
        { name: 'cmd1', prompt: 'p1' },
        { name: 'cmd2', prompt: 'p2' },
      ];
      deps.getFilteredCommands.mockReturnValue(cmds);
      deps.getCommandSelectedIndex.mockReturnValue(1); // last index

      pressKey(deps.userInput, 'ArrowDown');

      // (1 + 1) % 2 = 0 → wraps to first
      expect(deps.setCommandSelectedIndex).toHaveBeenCalledWith(0);
    });

    it('ArrowUp decrements selected index (wraps around)', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);
      deps.getFilteredCommands.mockReturnValue([
        { name: 'cmd1', prompt: 'p1' },
        { name: 'cmd2', prompt: 'p2' },
      ]);
      deps.getCommandSelectedIndex.mockReturnValue(1);

      const event = pressKey(deps.userInput, 'ArrowUp');

      expect(event.defaultPrevented).toBe(true);
      expect(deps.setCommandSelectedIndex).toHaveBeenCalledWith(0); // 1→0
    });

    it('ArrowUp wraps from first to last', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);
      const cmds = [
        { name: 'cmd1', prompt: 'p1' },
        { name: 'cmd2', prompt: 'p2' },
        { name: 'cmd3', prompt: 'p3' },
      ];
      deps.getFilteredCommands.mockReturnValue(cmds);
      deps.getCommandSelectedIndex.mockReturnValue(0); // first index

      pressKey(deps.userInput, 'ArrowUp');

      // (0 - 1 + 3) % 3 = 2 → wraps to last
      expect(deps.setCommandSelectedIndex).toHaveBeenCalledWith(2);
    });

    it('Enter executes selected command when popup open and commands exist', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);
      const cmds = [{ name: 'cmd1', prompt: 'p1' }];
      deps.getFilteredCommands.mockReturnValue(cmds);
      deps.getCommandSelectedIndex.mockReturnValue(0);

      const event = pressKey(deps.userInput, 'Enter');

      expect(event.defaultPrevented).toBe(true);
      expect(deps.executeQuickCommand).toHaveBeenCalledWith(cmds[0]);
    });

    it('Enter hides popup when no commands match', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);
      deps.getFilteredCommands.mockReturnValue([]); // no matches

      pressKey(deps.userInput, 'Enter');

      expect(deps.hideCommandPopup).toHaveBeenCalled();
      expect(deps.executeQuickCommand).not.toHaveBeenCalled();
    });

    it('Shift+Enter does NOT trigger command execution (popup open)', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);
      deps.getFilteredCommands.mockReturnValue([{ name: 'cmd1', prompt: 'p1' }]);

      pressKey(deps.userInput, 'Enter', { shiftKey: true });

      expect(deps.executeQuickCommand).not.toHaveBeenCalled();
    });

    it('Escape hides popup', () => {
      deps.isCommandPopupOpen.mockReturnValue(true);

      const event = pressKey(deps.userInput, 'Escape');

      expect(event.defaultPrevented).toBe(true);
      expect(deps.hideCommandPopup).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // handleKeydown — normal typing (popup closed)
  // ==========================================================================
  describe('keydown: normal typing (popup closed)', () => {
    beforeEach(() => {
      initAIChat(deps);
      deps.isCommandPopupOpen.mockReturnValue(false);
    });

    it('Enter sends message when popup is closed', () => {
      const event = pressKey(deps.userInput, 'Enter');

      expect(event.defaultPrevented).toBe(true);
      expect(sendMessage).toHaveBeenCalled();
    });

    it('Shift+Enter does NOT send message (allows newline)', () => {
      const event = pressKey(deps.userInput, 'Enter', { shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('Arrow keys do nothing when popup is closed', () => {
      pressKey(deps.userInput, 'ArrowDown');

      expect(deps.setCommandSelectedIndex).not.toHaveBeenCalled();
      expect(deps.renderCommandPopup).not.toHaveBeenCalled();
    });

    it('Escape does nothing when popup is closed', () => {
      pressKey(deps.userInput, 'Escape');

      expect(deps.hideCommandPopup).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Re-exports
  // ==========================================================================
  describe('re-exports', () => {
    it('re-exports sendToAI, sendMessage, retryMessage, extractPageContent', () => {
      // Verify these are functions (re-exported from ai-chat)
      expect(typeof sendToAI).toBe('function');
      expect(typeof sendMessage).toBe('function');
      expect(typeof retryMessage).toBe('function');
      expect(typeof extractPageContent).toBe('function');
    });
  });
});
