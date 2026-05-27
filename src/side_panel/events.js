// events.js — Lightweight synchronous event bus to decouple layers

/**
 * Centralized event name constants — replaces magic strings scattered across modules.
 * Every emit() / on() call must reference these keys instead of inline string literals.
 */
export const EVENTS = {
  RETRY: 'retry',
  REMOVE_SUGGEST_QUESTIONS: 'removeSuggestQuestions',
  REQUEST_RERENDER: 'requestRerender',
  GENERATE_SUGGESTIONS: 'generateSuggestions',
  GENERATE_OUTLINE: 'generateOutline',
  CLEAR_QUOTE_PREVIEW: 'clearQuotePreview',
  CHART_CLICK: 'chartClick',
  PODCAST_CLICK: 'podcastClick',
  ADD_TTS_BUTTON: 'addTTSButton',
  SAVE_CURRENT_CHAT: 'saveCurrentChat',
};

const handlers = new Map();

/**
 * Subscribe to an event.
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 * @returns {Function} Unsubscribe function
 */
export function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
  return () => handlers.get(event)?.delete(handler);
}

/**
 * Unsubscribe a handler from an event.
 * @param {string} event - Event name
 * @param {Function} handler - Previously registered handler
 * @returns {void}
 */
export function off(event, handler) {
  handlers.get(event)?.delete(handler);
}

/**
 * Emit an event, invoking all registered handlers with the given arguments.
 * @param {string} event - Event name
 * @param {...*} args - Arguments forwarded to each handler
 * @returns {void}
 */
export function emit(event, ...args) {
  handlers.get(event)?.forEach(fn => fn(...args));
}
