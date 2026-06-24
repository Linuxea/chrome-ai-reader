import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
  getCurrentLang: () => 'zh',
}));

vi.mock('../../src/shared/prompts', () => ({
  getPrompt: (key) => `[${key}]`,
}));

vi.mock('../../src/side_panel/ui/dom-helpers.js', () => ({
  smartScrollToBottom: vi.fn(),
}));

vi.mock('../../src/side_panel/state.js', () => ({
  isSuggestQuestionsEnabled: vi.fn(() => true),
  setSuggestQuestionsEnabled: vi.fn(),
}));

import * as stateMock from '../../src/side_panel/state.js';

// Chrome mock with programmable port
const { createMockPort } = await import('../helpers/chrome-mock.js');

let currentPort = null;

// Set up chrome global before module import — use vi.hoisted for shared state
const storageSyncListeners = new Set();

vi.hoisted(() => {
  globalThis.chrome = {
    storage: {
      sync: {
        get: vi.fn((keys, cb) => cb({})),
        set: vi.fn((items, cb) => cb?.()),
      },
      onChanged: {
        addListener: vi.fn((fn) => storageSyncListeners.add(fn)),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      connect: vi.fn(() => createMockPort('suggest-questions')),
    },
  };
});

import {
  initSuggestQuestions,
  removeSuggestQuestions,
  generateSuggestions,
} from '../../src/side_panel/features/suggest-questions.js';

describe('initSuggestQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateMock.isSuggestQuestionsEnabled.mockReturnValue(true);
    stateMock.setSuggestQuestionsEnabled.mockImplementation(() => {});
    chrome.storage.sync.get.mockImplementation((keys, cb) => cb({}));
  });

  it('reads suggestQuestions setting from storage', () => {
    const chatArea = document.createElement('div');
    initSuggestQuestions({ chatArea, userInput: document.createElement('input'), onSend: vi.fn() });
    expect(chrome.storage.sync.get).toHaveBeenCalledWith(['suggestQuestions'], expect.any(Function));
  });

  it('enables suggestions when storage has suggestQuestions=true', () => {
    chrome.storage.sync.get.mockImplementation((keys, cb) => cb({ suggestQuestions: true }));
    const chatArea = document.createElement('div');
    initSuggestQuestions({ chatArea, userInput: document.createElement('input'), onSend: vi.fn() });
    expect(stateMock.setSuggestQuestionsEnabled).toHaveBeenCalledWith(true);
  });

  it('disables suggestions when storage has suggestQuestions=false', () => {
    chrome.storage.sync.get.mockImplementation((keys, cb) => cb({ suggestQuestions: false }));
    const chatArea = document.createElement('div');
    initSuggestQuestions({ chatArea, userInput: document.createElement('input'), onSend: vi.fn() });
    expect(stateMock.setSuggestQuestionsEnabled).toHaveBeenCalledWith(false);
  });

  it('defaults to enabled when setting is undefined', () => {
    chrome.storage.sync.get.mockImplementation((keys, cb) => cb({}));
    const chatArea = document.createElement('div');
    initSuggestQuestions({ chatArea, userInput: document.createElement('input'), onSend: vi.fn() });
    expect(stateMock.setSuggestQuestionsEnabled).toHaveBeenCalledWith(true);
  });

  it('reacts to storage change events', () => {
    const chatArea = document.createElement('div');
    initSuggestQuestions({ chatArea, userInput: document.createElement('input'), onSend: vi.fn() });
    const listener = storageSyncListeners.values().next().value;
    listener({ suggestQuestions: { newValue: false } }, 'sync');
    expect(stateMock.setSuggestQuestionsEnabled).toHaveBeenCalledWith(false);
  });
});

describe('removeSuggestQuestions', () => {
  it('removes suggest elements from chat area', () => {
    const chatArea = document.createElement('div');
    const suggestEl = document.createElement('div');
    suggestEl.className = 'suggest-questions';
    chatArea.appendChild(suggestEl);
    initSuggestQuestions({ chatArea, userInput: document.createElement('input'), onSend: vi.fn() });
    removeSuggestQuestions();
    expect(chatArea.querySelector('.suggest-questions')).toBeNull();
  });

  it('removes suggest-loading elements', () => {
    const chatArea = document.createElement('div');
    const loadingEl = document.createElement('div');
    loadingEl.className = 'suggest-loading';
    chatArea.appendChild(loadingEl);
    initSuggestQuestions({ chatArea, userInput: document.createElement('input'), onSend: vi.fn() });
    removeSuggestQuestions();
    expect(chatArea.querySelector('.suggest-loading')).toBeNull();
  });
});

describe('generateSuggestions', () => {
  let chatArea, userInput, onSend;

  beforeEach(() => {
    vi.clearAllMocks();
    stateMock.isSuggestQuestionsEnabled.mockReturnValue(true);
    // Restore chrome.runtime.connect
    chrome.runtime.connect = vi.fn(() => {
      currentPort = createMockPort('suggest-questions');
      return currentPort;
    });
    chatArea = document.createElement('div');
    userInput = document.createElement('input');
    onSend = vi.fn();
    initSuggestQuestions({ chatArea, userInput, onSend });
  });

  it('does nothing when suggestions are disabled', () => {
    stateMock.isSuggestQuestionsEnabled.mockReturnValue(false);
    const msgEl = document.createElement('div');
    generateSuggestions(msgEl, []);
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('shows loading indicator and connects to port', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, [{ role: 'user', content: 'hello' }]);
    expect(chatArea.querySelector('.suggest-loading')).not.toBeNull();
    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'suggest-questions' });
  });

  it('sends correct messages via port', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, [
      { role: 'user', content: 'what is AI?' },
      { role: 'assistant', content: 'AI is...' },
    ]);

    expect(currentPort.postMessage).toHaveBeenCalledWith({
      type: 'suggest',
      messages: expect.arrayContaining([
        { role: 'system', content: '[suggest]' },
        expect.objectContaining({ role: 'user' }),
      ]),
    });
  });

  it('renders suggestion buttons on done', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);

    currentPort._simulateMessage({ type: 'chunk', content: 'Q1?\nQ2?\nQ3?' });
    currentPort._simulateMessage({ type: 'done' });

    const buttons = chatArea.querySelectorAll('.suggest-item');
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent).toBe('Q1?');
  });

  it('limits suggestions to 3', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);

    currentPort._simulateMessage({ type: 'chunk', content: 'A?\nB?\nC?\nD?\nE?' });
    currentPort._simulateMessage({ type: 'done' });

    const buttons = chatArea.querySelectorAll('.suggest-item');
    expect(buttons.length).toBe(3);
  });

  it('strips numbering from suggestions', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);

    currentPort._simulateMessage({ type: 'chunk', content: '1. First?\n2. Second?\n3. Third?' });
    currentPort._simulateMessage({ type: 'done' });

    const buttons = chatArea.querySelectorAll('.suggest-item');
    expect(buttons[0].textContent).toBe('First?');
    expect(buttons[1].textContent).toBe('Second?');
  });

  it('removes loading indicator on done', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);
    expect(chatArea.querySelector('.suggest-loading')).not.toBeNull();

    currentPort._simulateMessage({ type: 'chunk', content: 'Q?' });
    currentPort._simulateMessage({ type: 'done' });
    expect(chatArea.querySelector('.suggest-loading')).toBeNull();
  });

  it('clicking a suggestion button sets input and calls onSend', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);

    currentPort._simulateMessage({ type: 'chunk', content: 'What about X?' });
    currentPort._simulateMessage({ type: 'done' });

    const btn = chatArea.querySelector('.suggest-item');
    btn.click();
    expect(userInput.value).toBe('What about X?');
    expect(onSend).toHaveBeenCalled();
  });

  it('removes loading indicator on error', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);

    currentPort._simulateMessage({ type: 'error' });
    expect(chatArea.querySelector('.suggest-loading')).toBeNull();
  });

  it('removes loading indicator on disconnect', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);

    currentPort._simulateDisconnect();
    expect(chatArea.querySelector('.suggest-loading')).toBeNull();
  });

  it('truncates long assistant content to 2000 chars', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    const longContent = 'x'.repeat(3000);
    generateSuggestions(msgEl, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: longContent },
    ]);

    const posted = currentPort.postMessage.mock.calls[0][0];
    const userMsg = posted.messages[1];
    expect(userMsg.content).toContain('[suggest.aiLabel]');
    expect(userMsg.content).toContain('...');
    expect(userMsg.content.length).toBeLessThan(longContent.length + 100);
  });

  it('does nothing on done if msgEl is removed from DOM', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);
    msgEl.remove();

    currentPort._simulateMessage({ type: 'chunk', content: 'Q?' });
    currentPort._simulateMessage({ type: 'done' });
    expect(chatArea.querySelector('.suggest-questions')).toBeNull();
  });

  it('does not render suggestions when result is empty', () => {
    const msgEl = document.createElement('div');
    chatArea.appendChild(msgEl);
    generateSuggestions(msgEl, []);

    currentPort._simulateMessage({ type: 'chunk', content: '' });
    currentPort._simulateMessage({ type: 'done' });
    expect(chatArea.querySelector('.suggest-questions')).toBeNull();
  });
});
