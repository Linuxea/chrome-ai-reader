import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * stream-handler × window-global TTS:
 *  - the live answer bubble carries the same id as its history entry
 *    (the TTS re-attach anchor survives chat-area rebuilds)
 *  - a plain send does not stop a running TTS (printer resource)
 *  - an autoplay send takes the resource over (previous playback stopped)
 */

globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

class MockAudio {
  constructor() {
    this.src = '';
    this.listeners = {};
  }
  play() { return Promise.resolve(); }
  pause() {}
  addEventListener(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  }
  removeEventListener(event, fn) {
    if (this.listeners[event]) this.listeners[event] = this.listeners[event].filter(f => f !== fn);
  }
}
globalThis.Audio = MockAudio;

class MockMediaSource {
  constructor() {
    this.readyState = 'open';
    this.sourceBuffers = [];
    this.listeners = {};
  }
  addSourceBuffer() {
    const sb = {
      buffered: { length: 0 },
      listeners: {},
      appendBuffer: vi.fn(),
      addEventListener(event, fn) {
        (this.listeners[event] ||= []).push(fn);
      },
      removeEventListener(event, fn) {
        if (this.listeners[event]) this.listeners[event] = this.listeners[event].filter(f => f !== fn);
      },
    };
    this.sourceBuffers.push(sb);
    return sb;
  }
  endOfStream() { this.readyState = 'closed'; }
  addEventListener(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  }
}
globalThis.MediaSource = MockMediaSource;

const { createMockPort } = await import('../../helpers/chrome-mock.js');

// Hybrid promise/callback chrome mock (state.initState awaits storage.get) —
// same pattern as tests/side_panel/state.test.js.
function buildChrome() {
  const store = { sync: {}, session: {}, local: {} };
  function area(key) {
    return {
      get(keys, cb) {
        const result = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (store[key][k] !== undefined) result[k] = store[key][k];
        });
        if (cb) { cb(result); return; }
        return Promise.resolve(result);
      },
      set(items, cb) {
        Object.assign(store[key], items);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
      remove(keys, cb) {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[key][k]);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
    };
  }
  return {
    storage: {
      sync: area('sync'),
      session: area('session'),
      local: area('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect: vi.fn(() => createMockPort('ai-chat')),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
}
const chrome = buildChrome();
globalThis.chrome = chrome;

import { initState, switchToTab, getStateForTab } from '../../../src/side_panel/state.js';
import { initDOMHelpers } from '../../../src/side_panel/ui/dom-helpers.js';
import { callAI, initStreamHandler } from '../../../src/side_panel/services/stream-handler.js';
import { initTTS, isTTSPlaying, stopTTS } from '../../../src/side_panel/services/tts/index.js';
import { initTTSPlayback as startPlayback, setTTSAutoPlay, subscribeTTSState } from '../../../src/side_panel/services/tts/player.js';

describe('stream-handler × window-global TTS', () => {
  let chatArea;
  let port;

  beforeEach(async () => {
    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);

    port = createMockPort('ai-chat');
    chrome.runtime.connect = vi.fn(() => port);

    initDOMHelpers({
      chatArea,
      actionBtns: document.querySelectorAll('.action-btn'),
      sendBtn: document.createElement('button'),
      userInput: document.createElement('textarea'),
      hasAttachments: () => false,
    });
    initStreamHandler({ chatArea });

    await initState();
    await switchToTab(1);
    initTTS({ chatArea });
    stopTTS();
    setTTSAutoPlay(false);
  });

  afterEach(() => {
    stopTTS();
    document.body.innerHTML = '';
  });

  it('the finished answer bubble carries the id of its history entry (TTS anchor)', async () => {
    await callAI([{ id: 'u1', role: 'user', content: 'hi' }], 1);
    port._simulateMessage({ type: 'chunk', content: 'Hello there.' });
    port._simulateMessage({ type: 'done', finishReason: 'stop' });

    const ts = getStateForTab(1);
    const last = ts.conversationHistory[ts.conversationHistory.length - 1];
    expect(last.role).toBe('assistant');

    const bubble = chatArea.querySelector('.message-ai');
    expect(bubble).not.toBeNull();
    expect(bubble.dataset.msgId).toBe(last.id);
  });

  it('a plain send (autoplay off) does not stop a running TTS', async () => {
    startPlayback(null, { tabId: 1, msgId: 'old' });
    expect(isTTSPlaying()).toBe(true);

    await callAI([{ id: 'u1', role: 'user', content: 'hi' }], 1);
    port._simulateMessage({ type: 'chunk', content: 'Answer.' });
    port._simulateMessage({ type: 'done', finishReason: 'stop' });

    expect(isTTSPlaying()).toBe(true); // printer keeps printing
  });

  it('an autoplay send takes the audio resource over from the running playback', async () => {
    const states = [];
    const unsubscribe = subscribeTTSState(s => states.push({ ...s }));
    try {
      setTTSAutoPlay(true);
      startPlayback(null, { tabId: 1, msgId: 'old' });
      states.length = 0;

      await callAI([{ id: 'u1', role: 'user', content: 'hi' }], 1);

      // the previous playback was fully stopped (takeover), a new one runs
      expect(states.some(s => !s.playing)).toBe(true);
      expect(isTTSPlaying()).toBe(true);
    } finally {
      unsubscribe();
    }
  });
});
