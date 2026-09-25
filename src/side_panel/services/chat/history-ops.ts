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

export { stripImagesForPersistence } from '../../../shared/strip-images';

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
 * Truncate conversation history starting at the message with `id` (the
 * message itself included). Unlike content matching this is exact even when
 * several user turns carry the same text (e.g. the same quick action twice).
 * If no message has that id (e.g. a failed send already rolled it back),
 * history is unchanged.
 *
 * @returns the index where truncation began, or -1 if nothing was removed.
 */
export function truncateHistoryFromId(tabState: TabState, id: string, tabId: number): number {
  const hist = tabState.conversationHistory;
  const idx = hist.findIndex(m => m.id === id);
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

/**
 * The wire form of a history message: only the OpenAI chat fields. Local
 * bookkeeping (`meta`, `hadImages`, `type`) stays in the panel — strict
 * OpenAI-compatible providers reject unknown message properties.
 */
export function toApiMessage(msg: ChatMessage): ChatMessage {
  const out: ChatMessage = { role: msg.role, content: msg.content };
  if (msg.name) out.name = msg.name;
  if (msg.tool_calls) out.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
  return out;
}

// --- F10: branches ------------------------------------------------------------

/** Anchor for a fork at the very first message. */
export const ROOT_BRANCH = '__root__';

/** The branch anchor of the message at `index`: the id of the message before it. */
export function anchorAt(history: ChatMessage[], index: number): string {
  return index > 0 ? history[index - 1].id ?? ROOT_BRANCH : ROOT_BRANCH;
}

/**
 * Retry / edit without losing work: cut the history at message `id` (like
 * truncateHistoryFromId) but keep the removed continuation as a branch at
 * the fork point, and make the next continuation the active one.
 *
 * @returns the index where the cut began, or -1.
 */
export function branchFromId(tabState: TabState, id: string, tabId: number): number {
  const hist = tabState.conversationHistory;
  const idx = hist.findIndex(m => m.id === id);
  if (idx === -1) return -1;
  const anchor = anchorAt(hist, idx);
  const removed = hist.splice(idx, hist.length - idx);
  tabState.branches ??= {};
  const set = tabState.branches[anchor] ?? { tails: [null], active: 0 };
  set.tails[set.active] = removed;
  set.tails.push(null);
  set.active = set.tails.length - 1;
  tabState.branches[anchor] = set;
  state.persistForTab(tabId);
  return idx;
}

/** Position of the fork at `anchor` for display: {index (1-based), total}, or null. */
export function branchInfo(tabState: TabState, anchor: string): { index: number; total: number } | null {
  const set = tabState.branches?.[anchor];
  if (!set || set.tails.length < 2) return null;
  return { index: set.active + 1, total: set.tails.length };
}

/**
 * Show continuation `to` of the fork at `anchor`: the live tail is parked in
 * the branch set and the chosen one becomes the history after the anchor.
 */
export function switchBranch(tabState: TabState, anchor: string, to: number, tabId: number): boolean {
  const set = tabState.branches?.[anchor];
  if (!set || to < 0 || to >= set.tails.length || to === set.active) return false;
  const hist = tabState.conversationHistory;
  const start = anchor === ROOT_BRANCH ? 0 : hist.findIndex(m => m.id === anchor) + 1;
  if (anchor !== ROOT_BRANCH && start === 0) return false; // anchor not on the live path
  set.tails[set.active] = hist.splice(start, hist.length - start);
  hist.push(...(set.tails[to] ?? []));
  set.tails[to] = null;
  set.active = to;
  state.persistForTab(tabId);
  return true;
}
