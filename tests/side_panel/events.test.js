import { describe, it, expect, vi, beforeEach } from 'vitest';
import { on, off, emit } from '../../src/side_panel/events.js';

// The handlers Map is module-scoped and persists across tests within this file.
// Use unsubscribe or off() to clean up after each test so handlers don't leak.
describe('events', () => {
  // Collect unsubscribe functions so we can clean up between tests
  const cleanups = [];

  beforeEach(() => {
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
  });

  describe('on()', () => {
    it('subscribes a handler that receives emitted events', () => {
      const handler = vi.fn();
      const unsub = on('test', handler);
      cleanups.push(unsub);
      emit('test', 'hello');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith('hello');
    });

    it('returns an unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = on('test', handler);
      unsub();
      emit('test', 'hello');
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribe function is idempotent (calling twice is safe)', () => {
      const handler = vi.fn();
      const unsub = on('test', handler);
      unsub();
      unsub(); // Second call should not throw
      emit('test');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('off()', () => {
    it('removes a specific handler from an event', () => {
      const handler = vi.fn();
      on('test', handler);
      off('test', handler);
      emit('test');
      expect(handler).not.toHaveBeenCalled();
    });

    it('only removes the specified handler, not others on the same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const unsub1 = on('test', handler1);
      const unsub2 = on('test', handler2);
      cleanups.push(unsub1, unsub2);

      off('test', handler1);
      emit('test');
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('does nothing when called on a non-existent event', () => {
      // Should not throw
      expect(() => off('nonexistent', vi.fn())).not.toThrow();
    });

    it('does nothing when the handler was never registered', () => {
      const handler = vi.fn();
      const unsub = on('test', handler);
      cleanups.push(unsub);
      // off() with a different handler reference
      expect(() => off('test', vi.fn())).not.toThrow();
      emit('test');
      // Original handler should still be called
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('emit()', () => {
    it('calls all handlers registered for an event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const h3 = vi.fn();
      const unsub1 = on('multi', h1);
      const unsub2 = on('multi', h2);
      const unsub3 = on('multi', h3);
      cleanups.push(unsub1, unsub2, unsub3);

      emit('multi');
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
      expect(h3).toHaveBeenCalledOnce();
    });

    it('forwards multiple arguments to handlers', () => {
      const handler = vi.fn();
      const unsub = on('args', handler);
      cleanups.push(unsub);

      emit('args', 1, 'two', { three: 3 }, [4]);
      expect(handler).toHaveBeenCalledWith(1, 'two', { three: 3 }, [4]);
    });

    it('does not crash when emitting an event with no handlers', () => {
      expect(() => emit('no-handlers')).not.toThrow();
    });

    it('does not call handlers registered for a different event', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const unsubA = on('event-a', handlerA);
      const unsubB = on('event-b', handlerB);
      cleanups.push(unsubA, unsubB);

      emit('event-a');
      expect(handlerA).toHaveBeenCalledOnce();
      expect(handlerB).not.toHaveBeenCalled();
    });
  });

  describe('event isolation', () => {
    it('different events are fully independent', () => {
      const handlerX = vi.fn();
      const handlerY = vi.fn();
      const unsubX = on('x', handlerX);
      const unsubY = on('y', handlerY);
      cleanups.push(unsubX, unsubY);

      emit('x', 'data-x');
      emit('y', 'data-y');

      expect(handlerX).toHaveBeenCalledWith('data-x');
      expect(handlerX).toHaveBeenCalledOnce();
      expect(handlerY).toHaveBeenCalledWith('data-y');
      expect(handlerY).toHaveBeenCalledOnce();
    });

    it('unsubscribing from one event does not affect another', () => {
      const handlerX = vi.fn();
      const handlerY = vi.fn();
      const unsubX = on('x', handlerX);
      const unsubY = on('y', handlerY);
      cleanups.push(unsubY);

      unsubX();
      emit('x');
      emit('y', 'still-here');
      expect(handlerX).not.toHaveBeenCalled();
      expect(handlerY).toHaveBeenCalledWith('still-here');
    });
  });
});
