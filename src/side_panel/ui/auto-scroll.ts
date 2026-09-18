/**
 * Stick-to-bottom scroll policy for the chat area.
 *
 * Replaces the old per-flush 80px-threshold heuristic, which re-evaluated
 * "should I follow?" on every stream flush and fought the user's manual
 * scrolling near the bottom. Here the policy is explicit state, driven by the
 * user's own scroll position:
 *
 *   - The user scrolls up beyond STICK_EPSILON  → unstick, auto-follow stops.
 *   - The user returns within STICK_EPSILON     → restick, auto-follow resumes.
 *
 * Programmatic `scrollToBottom()` always lands at distance 0, so it implicitly
 * resticks — one-shot forced scrolls (send message, tab switch, history load)
 * need no extra reset. `smartScrollToBottom()` is a no-op while unstuck, so
 * streaming content can grow freely below without yanking the view.
 *
 * `createInnerFollower()` applies the identical policy to a nested scroller
 * (the thinking box's .thinking-content) so live thinking text follows itself
 * without fighting manual reading inside the box.
 */

const STICK_EPSILON = 24;

let _chatArea: HTMLElement | null = null;
let _stick = true;

function distanceToBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function initAutoScroll(chatArea: HTMLElement): void {
  _chatArea = chatArea;
  _stick = true;
  chatArea.addEventListener('scroll', () => {
    _stick = distanceToBottom(chatArea) <= STICK_EPSILON;
  });
}

/** Forced jump to the bottom; implicitly resticks. */
export function scrollToBottom(): void {
  if (!_chatArea) return;
  _chatArea.scrollTop = _chatArea.scrollHeight;
  _stick = true;
}

/** Follow the bottom only while the user is stuck to it. */
export function smartScrollToBottom(): void {
  if (_stick) scrollToBottom();
}

/**
 * Auto-follow helper for a nested scroller. Returns a `follow()` that pins the
 * element to its own bottom unless the user has scrolled it away from the end.
 */
export function createInnerFollower(el: HTMLElement): () => void {
  let stick = true;
  el.addEventListener('scroll', () => {
    stick = distanceToBottom(el) <= STICK_EPSILON;
  });
  return () => {
    if (!stick || !el.isConnected) return;
    el.scrollTop = el.scrollHeight;
  };
}
