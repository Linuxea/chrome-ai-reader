// events.js — Lightweight synchronous event bus to decouple layers

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
