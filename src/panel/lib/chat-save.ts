/**
 * Chat save/load — React port of features/chat-history.ts's persistence
 * half. The DOM-scraping getDisplayMessages() is replaced by a derivation
 * from conversationHistory DATA (meta-driven bubbles), which is exactly
 * what the legacy scraper was trying to recover from the DOM.
 *
 * Kept verbatim: the save-queue serialization (snapshots captured
 * synchronously, writes async + in order), the chat-id assignment rules
 * (immediate on first save, unique per save), and the don't-resurrect-
 * deleted-chats rule.
 */
import { t, getCurrentLang } from '@/shared/i18n.js';
import { genId } from '@/shared/ids';
import { stripImagesForPersistence } from '@/shared/strip-images';
import { downloadFile, sanitizeFilename } from '@/shared/download';
import type { ChatMessage } from '@/shared/types';
import {
  listChats, getChat, putChat, deleteChatRecord,
  type ChatHistoryEntry, type DisplayMessage,
} from '@/shared/chats-db';
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { removeSuggestions } from './suggest';

export type { ChatHistoryEntry };

/** Derive the display snapshot from history data (no DOM scraping). */
export function displayMessagesFromHistory(history: ChatMessage[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  for (const m of history) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      const text = m.meta?.displayText ?? (typeof m.content === 'string' ? m.content : '');
      const msg: DisplayMessage = { role: 'user', content: text || t('chat.imageOnly') };
      if (m.meta?.quote) msg.quote = m.meta.quote;
      out.push(msg);
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: typeof m.content === 'string' ? m.content : '', format: 'md' });
    }
  }
  return out;
}

let _saveQueue: Promise<void> = Promise.resolve();

/**
 * Snapshot + persist one tab's chat. Defaults to the active tab; the stream
 * controller passes the STREAM's tab explicitly (an answer finishing in a
 * background tab must save THAT tab's chat — the active tab's snapshot
 * would be the wrong conversation, or empty → early-return → answer lost).
 */
export function saveCurrentChat(tabIdArg?: number): Promise<void> {
  const tabId = tabIdArg ?? core.getActiveTabId();
  if (tabId == null) return _saveQueue;
  const ts = core.getStateForTab(tabId);
  if (!ts) return _saveQueue;
  const messages = displayMessagesFromHistory(ts.conversationHistory);
  if (messages.length === 0) return _saveQueue;

  const now = Date.now();
  let chatId = ts.currentChatId;
  const isNew = !chatId;
  if (!chatId) {
    // Unique even for two chats saved in the same millisecond. Written to
    // THAT tab's state — the active-scoped setter would stamp the ACTIVE
    // tab (cross-chat corruption when a background tab saves first).
    chatId = `chat_${now}_${genId().slice(0, 8)}`;
    core.setCurrentChatIdForTab(tabId, chatId);
    useTabsStore.getState().bump();
  }
  const snapshot = {
    id: chatId,
    isNew,
    now,
    messages,
    chatTitle: ts.chatTitle ?? '',
    pageTitle: ts.pageTitle,
    pageUrl: ts.pageUrl,
    conversationHistory: ts.conversationHistory
      .filter(m => m.role !== 'system')
      .map(stripImagesForPersistence),
  };

  const run = _saveQueue.then(() => writeChat(snapshot));
  _saveQueue = run.catch(() => { /* keep the queue alive */ });
  return run;
}

async function writeChat(snap: {
  id: string; isNew: boolean; now: number; messages: DisplayMessage[];
  chatTitle: string; pageTitle: string; pageUrl?: string; conversationHistory: ChatMessage[];
}): Promise<void> {
  const existing = await getChat(snap.id);
  if (existing) {
    await putChat({
      ...existing,
      messages: snap.messages,
      conversationHistory: snap.conversationHistory,
      pageTitle: snap.pageTitle,
      pageUrl: snap.pageUrl || existing.pageUrl,
      // F16: once the conversation carries a live title it is the single
      // source of truth — later saves propagate renames into the record.
      title: snap.chatTitle || existing.title,
      updatedAt: snap.now,
    });
  } else if (snap.isNew) {
    await putChat({
      id: snap.id,
      // The LLM title may not have landed yet (or failed) — the first-user
      // heuristic is the interim/fallback title, same as pre-F16.
      title: snap.chatTitle || generateTitle(snap.messages),
      pageTitle: snap.pageTitle,
      pageUrl: snap.pageUrl,
      messages: snap.messages,
      conversationHistory: snap.conversationHistory,
      createdAt: snap.now,
      updatedAt: snap.now,
    });
  }
  // else: the chat was deleted meanwhile — don't resurrect it
}

/**
 * Rewrite the tab's saved record with its live title (F16). Used when the
 * title arrives AFTER the save that created the record (LLM generation is
 * slower than the save) and after a manual rename — otherwise the record
 * would keep the interim heuristic title until the next message. Serialized
 * through the save queue so it can never interleave with a save.
 */
export function syncChatTitleToRecord(tabId: number): void {
  const ts = core.getStateForTab(tabId);
  const chatId = ts?.currentChatId;
  const title = ts?.chatTitle?.trim();
  if (!chatId || !title) return;
  const run = _saveQueue.then(async () => {
    const existing = await getChat(chatId);
    // No record (never saved / deleted meanwhile) — nothing to update.
    if (existing && existing.title !== title) {
      await putChat({ ...existing, title });
    }
  });
  _saveQueue = run.catch(() => { /* keep the queue alive */ });
}

export function generateTitle(messages: DisplayMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    const text = firstUser.content.slice(0, 30);
    return text.length < firstUser.content.length ? `${text}...` : text;
  }
  return t('chat.newChat');
}

export async function listChatHistory(): Promise<ChatHistoryEntry[]> {
  return listChats();
}

export async function deleteChatById(id: string): Promise<void> {
  await deleteChatRecord(id);
  if (core.getCurrentChatId() === id) {
    core.setCurrentChatId(null);
    useTabsStore.getState().bump();
  }
}

/** Load a saved chat into the active tab's state (busy-guarded). */
export async function loadChat(id: string): Promise<boolean> {
  if (core.getIsGenerating()) {
    useUIStore.getState().pushToast(t('toast.busyGenerating'));
    return false;
  }
  const chat = await getChat(id);
  if (!chat) return false;

  const store = useTabsStore.getState();
  const tabId = core.getActiveTabId();
  // The outgoing conversation's quote / suggestion chips / live stream
  // leftovers must not bleed into the loaded chat (legacy handleLoadChat
  // cleared them too).
  store.setSelectedText('');
  if (tabId != null) {
    removeSuggestions(tabId);
    useStreamStore.getState().clear(tabId);
  }
  // History-first render (same path as a tab switch): user bubbles come
  // back with their original text/quote and working retry/edit.
  store.setPageTitle(chat.pageTitle || '');
  store.setCurrentChatId(chat.id);
  // F16: the conversation's title follows it into the tab — the header,
  // later saves and audio downloads all read the same field.
  store.setChatTitle(chat.title || '');
  store.setConversationHistory(chat.conversationHistory || []);
  return true;
}

/** Export the active conversation as a Markdown file. */
export function exportCurrentChat(): void {
  const tabId = core.getActiveTabId();
  const ts = tabId != null ? core.getStateForTab(tabId) : null;
  if (!ts || ts.conversationHistory.length === 0) {
    useUIStore.getState().pushToast(t('sidebar.historyEmpty'));
    return;
  }
  const lines: string[] = [`# ${ts.chatTitle || ts.pageTitle || t('app.fullName')}`, ''];
  for (const m of ts.conversationHistory) {
    if (m.role === 'user') {
      lines.push(`## ${t('chat.user') || 'Q'}`, '', m.meta?.displayText ?? (typeof m.content === 'string' ? m.content : ''), '');
    } else if (m.role === 'assistant') {
      lines.push(`## ${t('chat.assistant') || 'A'}`, '', typeof m.content === 'string' ? m.content : '', '');
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  // F16: the file is named after the conversation's title (the header /
  // history / audio downloads all use the same one); pre-F16 records and
  // untitled chats keep the generic name.
  const titlePart = sanitizeFilename(ts.chatTitle || '').trim();
  downloadFile(lines.join('\n'), `${titlePart || 'chat'}_${date}.md`, 'text/markdown;charset=utf-8');
}

export { getCurrentLang };
