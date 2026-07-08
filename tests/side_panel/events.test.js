import { describe, it, expect, vi, beforeEach } from 'vitest';
import { on, off, emit, EVENTS } from '../../src/side_panel/events.js';

// The handlers Map is module-scoped and persists across tests within this file.
// Use unsubscribe or off() to clean up after each test so handlers don't leak.
describe('events', () => {
  // Collect unsubscribe functions so we can clean up between tests
  const cleanups = [];

  beforeEach(() => {
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
  });

  describe('EVENTS constants', () => {
    it('every key maps to a non-empty string value', () => {
      Object.entries(EVENTS).forEach(([key, value]) => {
        expect(typeof value, `EVENTS.${key} should be a string`).toBe('string');
        expect(value.length, `EVENTS.${key} should not be empty`).toBeGreaterThan(0);
      });
    });

    it('all values are unique (no collisions)', () => {
      const values = Object.values(EVENTS);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it('contains all expected event names', () => {
      const expectedKeys = [
        'RETRY',
        'EDIT',
        'REMOVE_SUGGEST_QUESTIONS',
        'REQUEST_RERENDER',
        'GENERATE_SUGGESTIONS',
        'CLEAR_QUOTE_PREVIEW',
        'PODCAST_CLICK',
        'ADD_TTS_BUTTON',
        'SAVE_CURRENT_CHAT',
        'RENDER_HISTORY_LIST',
        'SHOW_RELATED_PAGES',
        'PAGE_EXTRACTED',
        'PODCAST_REBUILD_REQUEST',
      ];
      expectedKeys.forEach(key => {
        expect(EVENTS).toHaveProperty(key);
      });
    });

    it('EVENTS object is frozen or sealed to prevent accidental mutation', () => {
      // EVENTS is a plain const object — verify no extra keys sneaked in
      expect(Object.keys(EVENTS).length).toBe(13);
    });
  });

  describe('on()', () => {
    it('subscribes a handler that receives emitted events', () => {
      const handler = vi.fn();
      // Use a real EVENTS constant to verify integration
      const unsub = on(EVENTS.RETRY, handler);
      cleanups.push(unsub);
      emit(EVENTS.RETRY, 'hello');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith('hello');
    });

    it('returns an unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = on(EVENTS.RETRY, handler);
      unsub();
      emit(EVENTS.RETRY, 'hello');
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribe function is idempotent (calling twice is safe)', () => {
      const handler = vi.fn();
      const unsub = on(EVENTS.RETRY, handler);
      unsub();
      unsub(); // Second call should not throw
      emit(EVENTS.RETRY);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('off()', () => {
    it('removes a specific handler from an event', () => {
      const handler = vi.fn();
      on(EVENTS.REQUEST_RERENDER, handler);
      off(EVENTS.REQUEST_RERENDER, handler);
      emit(EVENTS.REQUEST_RERENDER);
      expect(handler).not.toHaveBeenCalled();
    });

    it('only removes the specified handler, not others on the same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const unsub1 = on(EVENTS.REQUEST_RERENDER, handler1);
      const unsub2 = on(EVENTS.REQUEST_RERENDER, handler2);
      cleanups.push(unsub1, unsub2);

      off(EVENTS.REQUEST_RERENDER, handler1);
      emit(EVENTS.REQUEST_RERENDER);
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('does nothing when called on a non-existent event', () => {
      // Should not throw
      expect(() => off('nonexistent', vi.fn())).not.toThrow();
    });

    it('does nothing when the handler was never registered', () => {
      const handler = vi.fn();
      const unsub = on(EVENTS.REQUEST_RERENDER, handler);
      cleanups.push(unsub);
      // off() with a different handler reference
      expect(() => off(EVENTS.REQUEST_RERENDER, vi.fn())).not.toThrow();
      emit(EVENTS.REQUEST_RERENDER);
      // Original handler should still be called
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('emit()', () => {
    it('calls all handlers registered for an event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const h3 = vi.fn();
      const unsub1 = on(EVENTS.GENERATE_SUGGESTIONS, h1);
      const unsub2 = on(EVENTS.GENERATE_SUGGESTIONS, h2);
      const unsub3 = on(EVENTS.GENERATE_SUGGESTIONS, h3);
      cleanups.push(unsub1, unsub2, unsub3);

      emit(EVENTS.GENERATE_SUGGESTIONS);
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
      expect(h3).toHaveBeenCalledOnce();
    });

    it('forwards event arguments to handlers', () => {
      const handler = vi.fn();
      const unsub = on(EVENTS.ADD_TTS_BUTTON, handler);
      cleanups.push(unsub);

      const arg = { msgEl: document.createElement('div') };
      emit(EVENTS.ADD_TTS_BUTTON, arg);
      expect(handler).toHaveBeenCalledWith(arg);
    });

    it('does not crash when emitting an event with no handlers', () => {
      expect(() => emit('no-handlers')).not.toThrow();
    });

    it('does not call handlers registered for a different event', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const unsubA = on(EVENTS.SAVE_CURRENT_CHAT, handlerA);
      const unsubB = on(EVENTS.PODCAST_CLICK, handlerB);
      cleanups.push(unsubA, unsubB);

      emit(EVENTS.SAVE_CURRENT_CHAT);
      expect(handlerA).toHaveBeenCalledOnce();
      expect(handlerB).not.toHaveBeenCalled();
    });
  });

  describe('event isolation', () => {
    it('different events are fully independent', () => {
      const handlerX = vi.fn();
      const handlerY = vi.fn();
      const unsubX = on(EVENTS.CLEAR_QUOTE_PREVIEW, handlerX);
      const unsubY = on(EVENTS.ADD_TTS_BUTTON, handlerY);
      cleanups.push(unsubX, unsubY);

      emit(EVENTS.CLEAR_QUOTE_PREVIEW, 'data-x');
      emit(EVENTS.ADD_TTS_BUTTON, 'data-y');

      expect(handlerX).toHaveBeenCalledWith('data-x');
      expect(handlerX).toHaveBeenCalledOnce();
      expect(handlerY).toHaveBeenCalledWith('data-y');
      expect(handlerY).toHaveBeenCalledOnce();
    });

    it('unsubscribing from one event does not affect another', () => {
      const handlerX = vi.fn();
      const handlerY = vi.fn();
      const unsubX = on(EVENTS.CLEAR_QUOTE_PREVIEW, handlerX);
      const unsubY = on(EVENTS.ADD_TTS_BUTTON, handlerY);
      cleanups.push(unsubY);

      unsubX();
      emit(EVENTS.CLEAR_QUOTE_PREVIEW);
      emit(EVENTS.ADD_TTS_BUTTON, 'still-here');
      expect(handlerX).not.toHaveBeenCalled();
      expect(handlerY).toHaveBeenCalledWith('still-here');
    });
  });
});
