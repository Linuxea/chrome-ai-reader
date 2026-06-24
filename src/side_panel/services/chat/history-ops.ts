/**
 * Conversation history operations — centralized to eliminate triplicated
 * rollback logic that previously lived inline in message-sender.ts and
 * stream-handler.ts (three near-identical "pop trailing user message on
 * failure" blocks).
 *
 * These helpers operate on a TabState's conversationHistory in place and
 * persist via state.persistForTab(). Keeping them here means future changes
 * to the rollback policy (e.g. msgId-based matching, tool-call interleaving)
 * touch one file.
 */

import type { ChatMessage } from '../../../shared/types';
import * as state from '../../state';
import type { TabState } from '../../../shared/types';

export { stripImagesForPersistence } from './strip-images';

/**
 * Remove the trailing message if it is a user turn (a failed/aborted send).
 * Used by stream-handler (error + disconnect) and message-sender (catch).
 * No-op if history is empty or the last message isn't a user turn.
 *
 * @returns true if a message was removed.
 */
export function rollbackTrailingUserMessage(tabState: TabState, tabId: number): boolean {
  const hist = tabState.conversationHistory;
  if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
    hist.splice(hist.length - 1, 1);
    state.persistForTab(tabId);
    return true;
  }
  return false;
}

/**
 * Truncate conversation history starting from the first user message whose
 * content matches `userContent` (used by retry to discard the tail of the
 * conversation being retried). If no match is found, history is unchanged.
 *
 * Compares both string content and array content (multimodal messages) by
 * folding array content's text parts into a single string — visual messages
 * have their image_url blocks stripped for comparison purposes, so retry can
 * match a visual user message by its text portion.
 *
 * @returns the index where truncation began, or -1 if nothing was removed.
 */
export function truncateHistoryFromUserContent(
  tabState: TabState,
  userContent: string,
  tabId: number,
): number {
  const hist = tabState.conversationHistory;
  const idx = hist.findLastIndex(m => m.role === 'user' && normalizeContent(m.content) === userContent);
  if (idx !== -1) {
    hist.splice(idx, hist.length - idx);
    state.persistForTab(tabId);
  }
  return idx;
}

/**
 * Normalize a ChatMessage's content to a string for comparison purposes.
 * String content is returned as-is; array content is folded to its text parts
 * joined by newlines (image_url blocks are ignored).
 */
function normalizeContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<NonNullable<ChatMessage['content']>[number], { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

/**
 * Append a message to the conversation history and persist.
 * Centralizes the `tabState.conversationHistory.push(...) + persistForTab`
 * pattern that was duplicated across message-sender and stream-handler.
 */
export function appendMessage(tabState: TabState, msg: ChatMessage, tabId: number): void {
  tabState.conversationHistory.push(msg);
  state.persistForTab(tabId);
}
