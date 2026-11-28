/**
 * Conversation title (F16) — one title per conversation, used everywhere:
 * the panel header (in place of the app name), saved-chat records, TTS
 * audio download filenames and the markdown export.
 *
 * Generation: a one-shot JSON-mode request on the ai-chat port after the
 * FIRST exchange completes (any kept answer — done, or a stop/disconnect
 * that already produced text). Once a title exists it is never overwritten
 * by generation: a manual rename writes the same field, so user intent
 * always wins. A failure is quiet — the save path falls back to the
 * first-user-message heuristic, so a missing title never surfaces as an
 * error the user has to dismiss.
 *
 * Staleness: the answer arrives while the tab may have moved on (new chat
 * started, another conversation loaded). The generation captures the first
 * user message's id; if that message is no longer in the tab's history the
 * title is discarded instead of naming the wrong conversation.
 */
import { getCurrentLang } from '@/shared/i18n.js';
import { getPrompt } from '@/shared/prompts';
import type { ChatMessage } from '@/shared/types';
import type { AIChatRequest, StreamMessage } from '@/shared/protocol';
import { openAIChatPort } from '@/platform/ports';
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { syncChatTitleToRecord } from './chat-save';

/** Safety cap for a parsed title (the prompt asks for ≤16 zh / ≤40 en chars). */
const MAX_TITLE_CHARS = 40;
const QUESTION_CHARS = 300;
const ANSWER_CHARS = 400;

/** Fold message content to plain text (multimodal parts: text blocks only). */
function contentAsText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter(p => p.type === 'text').map(p => (p.type === 'text' ? p.text : '')).join('\n');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/**
 * Strip the wrapping a model sometimes adds (quotes, title marks, trailing
 * punctuation) and cap the length. Returns '' when nothing usable remains.
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^[\s"'`「」『』《》【]+/, '')
    .replace(/[\s"'`「」『』《》】。，、；：！？…,.!?;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_CHARS);
}

/** Parse the {"title": "..."} JSON the generator was told to produce. */
export function parseGeneratedTitle(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { title?: unknown };
    if (typeof data.title !== 'string') return null;
    const cleaned = cleanTitle(data.title);
    return cleaned || null;
  } catch {
    return null;
  }
}

/**
 * Generate the title for `tabId`'s conversation if it does not have one.
 * No-op when the tab already carries a title (generated earlier or renamed
 * by the user) or has no complete exchange (question + answer) yet.
 */
export function ensureChatTitle(tabId: number): void {
  const ts = core.getStateForTab(tabId);
  if (!ts) return;
  if (ts.chatTitle?.trim()) return;
  const firstUser = ts.conversationHistory.find(m => m.role === 'user');
  const firstAssistant = ts.conversationHistory.find(m => m.role === 'assistant');
  if (!firstUser || !firstAssistant) return;

  // Staleness guard — see the module doc.
  const guardId = firstUser.id ?? null;

  const lang = getCurrentLang();
  const lines: string[] = [];
  if (ts.pageTitle) lines.push(getPrompt('title.pageLabel', lang), ts.pageTitle, '');
  lines.push(
    getPrompt('title.questionLabel', lang),
    truncate(firstUser.meta?.displayText || contentAsText(firstUser.content), QUESTION_CHARS),
    '',
    getPrompt('title.answerLabel', lang),
    truncate(contentAsText(firstAssistant.content), ANSWER_CHARS),
  );

  const port = openAIChatPort();
  let full = '';
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    try { port.disconnect(); } catch { /* already disconnected */ }
  };

  port.onMessage.addListener((msg: StreamMessage) => {
    if (closed) return;
    if (msg.type === 'chunk') {
      full += msg.content || '';
    } else if (msg.type === 'retry') {
      // The worker restarted the request after a pre-text drop: the dead
      // attempt's fragments (if any) must not pollute the next answer.
      full = '';
    } else if (msg.type === 'done') {
      close();
      applyGeneratedTitle(tabId, guardId, parseGeneratedTitle(full));
    } else if (msg.type === 'error') {
      // Quiet: the save path's heuristic title covers the history list.
      close();
    }
  });

  const req: AIChatRequest = {
    type: 'chat',
    messages: [
      { role: 'system', content: getPrompt('title.gen', lang) },
      { role: 'user', content: lines.join('\n') },
    ],
    response_format: { type: 'json_object' },
  };
  port.postMessage(req);
}

/** Validate the (re-read) tab state and commit the generated title. */
function applyGeneratedTitle(tabId: number, guardId: string | null, title: string | null): void {
  if (!title) return;
  const ts = core.getStateForTab(tabId);
  if (!ts) return;
  if (guardId != null && !ts.conversationHistory.some(m => m.id === guardId)) return;
  // A rename (or a second generation's answer) landed meanwhile — it wins.
  if (ts.chatTitle?.trim()) return;
  core.setChatTitleForTab(tabId, title);
  useTabsStore.getState().bump();
  // The chat was already saved at stream end with the fallback title —
  // rewrite the record so the history list shows the real one.
  syncChatTitleToRecord(tabId);
}
