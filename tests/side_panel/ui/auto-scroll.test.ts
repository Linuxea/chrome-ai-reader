/**
 * Tests for side_panel/ui/auto-scroll.ts — stick-to-bottom scroll policy.
 *
 * The chat area follows streamed content only while the user is "stuck" to
 * the bottom. Stick state is derived from the user's own scroll position
 * (distance to bottom <= 24px). Forced scrollToBottom() always lands and
 * implicitly resticks; smartScrollToBottom() is a no-op while unstuck.
 *
 * jsdom returns 0 for scrollHeight/clientHeight and never clamps scrollTop,
 * so each test stubs the geometry with Object.defineProperty getters and
 * dispatches synthetic 'scroll' events to drive the state machine.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

import {
  initAutoScroll,
  scrollToBottom,
  smartScrollToBottom,
  createInnerFollower,
} from '../../../src/side_panel/ui/auto-scroll.js';

/** Build an element with stubbed scroll geometry. scrollTop stays writable. */
function makeScrollable(scrollHeight: number, clientHeight: number, scrollTop = 0): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  el.scrollTop = scrollTop;
  document.body.appendChild(el);
  return el;
}

/** Simulate the browser firing 'scroll' after the user (or JS) moved scrollTop. */
function userScrollsTo(el: HTMLElement, scrollTop: number): void {
  el.scrollTop = scrollTop;
  el.dispatchEvent(new Event('scroll'));
}

describe('ui/auto-scroll', () => {
  let chatArea: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    // scrollHeight 1000, clientHeight 400 → max scrollTop 600
    chatArea = makeScrollable(1000, 400);
    initAutoScroll(chatArea);
  });

  it('follows the bottom by default (stuck on init)', () => {
    smartScrollToBottom();
    expect(chatArea.scrollTop).toBe(1000); // scrollTop = scrollHeight, jsdom does not clamp
  });

  it('stops following once the user scrolls up beyond the epsilon', () => {
    userScrollsTo(chatArea, 500); // distance 100 > 24
    smartScrollToBottom();
    expect(chatArea.scrollTop).toBe(500);
  });

  it('keeps following while the user stays within the epsilon of the bottom', () => {
    userScrollsTo(chatArea, 590); // distance 10 <= 24
    smartScrollToBottom();
    expect(chatArea.scrollTop).toBe(1000);
  });

  it('resumes following when the user scrolls back to the bottom', () => {
    userScrollsTo(chatArea, 100); // unstick
    userScrollsTo(chatArea, 600); // back at the bottom
    smartScrollToBottom();
    expect(chatArea.scrollTop).toBe(1000);
  });

  it('forced scrollToBottom always jumps, even while unstuck, and resticks', () => {
    userScrollsTo(chatArea, 100); // unstick
    scrollToBottom();
    expect(chatArea.scrollTop).toBe(1000);

    // scrollToBottom() restuck synchronously; scrolling away again unsticks,
    // and a subsequent smart call must respect that.
    userScrollsTo(chatArea, 300);
    smartScrollToBottom();
    expect(chatArea.scrollTop).toBe(300);
  });

  it('re-init resets the stick state', () => {
    userScrollsTo(chatArea, 100); // unstick
    initAutoScroll(chatArea);
    smartScrollToBottom();
    expect(chatArea.scrollTop).toBe(1000);
  });

  describe('createInnerFollower', () => {
    it('pins the nested scroller to its own bottom while stuck', () => {
      const inner = makeScrollable(2000, 300);
      const follow = createInnerFollower(inner);
      follow();
      expect(inner.scrollTop).toBe(2000);
    });

    it('stops following once the user scrolls inside the nested scroller', () => {
      const inner = makeScrollable(2000, 300);
      const follow = createInnerFollower(inner);
      userScrollsTo(inner, 0); // distance 1700 > 24 → unstick
      follow();
      expect(inner.scrollTop).toBe(0);
    });

    it('ignores detached elements (message removed on rerender)', () => {
      const inner = makeScrollable(2000, 300);
      const follow = createInnerFollower(inner);
      inner.remove();
      follow();
      expect(inner.scrollTop).toBe(0);
    });

    it('inner stick state is independent of the chat area stick state', () => {
      const inner = makeScrollable(2000, 300);
      const follow = createInnerFollower(inner);
      userScrollsTo(chatArea, 100); // chat unstuck...
      follow(); // ...but inner stays stuck and follows
      expect(inner.scrollTop).toBe(2000);
      expect(chatArea.scrollTop).toBe(100);
    });
  });
});
