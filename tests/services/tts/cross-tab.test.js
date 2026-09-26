import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Window-global TTS ("printer resource") behavior:
 *  - tab switch detaches the button anchor but never stops playback
 *  - CHAT_RERENDERED re-attaches the anchor when back on the origin tab
 *  - loading another chat (handleLoadChat) keeps the audio running
 *  - starting a playback emits PODCAST_STOP_REQUEST (podcast mutual exclusion)
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

// Hybrid promise/callback chrome mock (state.initState awaits storage.get;
// tts/ports use callback style) — same pattern as tests/side_panel/state.test.js.
const { createMockPort } = await import('../../helpers/chrome-mock.js');

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
      connect: vi.fn(() => createMockPort('tts')),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
}
globalThis.chrome = buildChrome();

import { initState, switchToTab, getActiveTabId } from '../../../src/side_panel/state.js';
import { on, emit, EVENTS } from '../../../src/side_panel/events.js';
import { cleanupActiveFeatures, handleLoadChat } from '../../../src/side_panel/shell/tab-switch-handler.js';
import { initImages } from '../../../src/side_panel/services/images.js';
import {
  initTTS, isTTSPlaying, stopTTS, detachTTS, initTTSPlayback,
} from '../../../src/side_panel/services/tts/index.js';
import {
  initTTSPlayback as startPlayback, getTTSButton, getTTSOrigin,
} from '../../../src/side_panel/services/tts/player.js';

describe('TTS across tabs (window-global resource)', () => {
  let chatArea;

  const els = () => ({ chatArea });
  const deps = () => ({ detachTTS, removeSuggestQuestions: vi.fn() });

  beforeEach(async () => {
    document.body.innerHTML =
      '<button id="imageUploadBtn"></button><input id="imageFileInput"></input><div id="imagePreviewBar"></div>';
    initImages();

    chatArea = document.createElement('div');
    document.body.appendChild(chatArea);

    await initState();
    await switchToTab(1);
    initTTS({ chatArea });
    stopTTS(); // reset any playback left over from a previous test
  });

  afterEach(() => {
    stopTTS();
    document.body.innerHTML = '';
  });

  it('a tab switch detaches the anchor but keeps the audio playing', () => {
    const btn = document.createElement('button');
    startPlayback(btn, { tabId: 1, msgId: 'm1' });
    expect(isTTSPlaying()).toBe(true);

    // the shell's switch-away path (also used by handleLoadChat)
    cleanupActiveFeatures(els(), deps());

    expect(isTTSPlaying()).toBe(true); // printer keeps printing
    expect(getTTSButton()).toBeNull(); // anchor dropped
    expect(getTTSOrigin()).toEqual({ tabId: 1, msgId: 'm1' }); // origin survives
  });

  it('CHAT_RERENDERED re-attaches the rebuilt origin bubble\'s button with its state', async () => {
    startPlayback(null, { tabId: 1, msgId: 'm1' });
    cleanupActiveFeatures(els(), deps());

    // simulate the rebuilt chat area (tab switched back): fresh bubble + button
    chatArea.innerHTML = '';
    const bubble = document.createElement('div');
    bubble.className = 'message message-ai';
    bubble.dataset.msgId = 'm1';
    const freshBtn = document.createElement('button');
    freshBtn.className = 'tts-btn';
    bubble.appendChild(freshBtn);
    chatArea.appendChild(bubble);

    emit(EVENTS.CHAT_RERENDERED);

    expect(getTTSButton()).toBe(freshBtn);
    expect(freshBtn.classList.contains('tts-loading')).toBe(true); // audio not started yet

    // stopping from the re-attached anchor resets it
    stopTTS();
    expect(isTTSPlaying()).toBe(false);
    expect(freshBtn.classList.contains('tts-loading')).toBe(false);
  });

  it('does not re-attach on a tab other than the origin', async () => {
    startPlayback(null, { tabId: 1, msgId: 'm1' });
    cleanupActiveFeatures(els(), deps());

    await switchToTab(2);
    // decoy: tab 2 happens to render a bubble with the same message id
    chatArea.innerHTML = '';
    const bubble = document.createElement('div');
    bubble.dataset.msgId = 'm1';
    const decoyBtn = document.createElement('button');
    decoyBtn.className = 'tts-btn';
    bubble.appendChild(decoyBtn);
    chatArea.appendChild(bubble);

    emit(EVENTS.CHAT_RERENDERED);

    expect(getTTSButton()).toBeNull();
    expect(decoyBtn.classList.contains('tts-loading')).toBe(false);
    expect(isTTSPlaying()).toBe(true);
  });

  it('a rerender without the origin message drops the stale anchor but keeps playing', () => {
    const btn = document.createElement('button');
    startPlayback(btn, { tabId: 1, msgId: 'gone' });
    chatArea.innerHTML = ''; // the message was removed (retry/edit/branch)

    emit(EVENTS.CHAT_RERENDERED);

    expect(getTTSButton()).toBeNull();
    expect(isTTSPlaying()).toBe(true);
  });

  it('loading another chat keeps the audio running (only the anchor detaches)', () => {
    startPlayback(null, { tabId: 1, msgId: 'm1' });

    const quoteEls = {
      chatArea,
      quoteText: document.createElement('span'),
      quotePreview: document.createElement('div'),
    };
    handleLoadChat(quoteEls, deps(), { id: 'chat_2', messages: [] });

    expect(isTTSPlaying()).toBe(true);
    expect(getTTSButton()).toBeNull();
  });

  it('starting a playback emits PODCAST_STOP_REQUEST and binds the origin tab', () => {
    const handler = vi.fn();
    const unsubscribe = on(EVENTS.PODCAST_STOP_REQUEST, handler);
    try {
      initTTSPlayback(); // autoplay entry from stream-handler
      expect(handler).toHaveBeenCalledTimes(1);
      expect(getTTSOrigin()).toEqual({ tabId: getActiveTabId(), msgId: null });
    } finally {
      unsubscribe();
    }
  });
});
