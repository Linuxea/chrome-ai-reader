/**
 * Suggest chips — React port of features/suggest-questions.ts. The chips
 * live in a store keyed by tab (the loading bar + questions render under
 * the last answer); clicking fills the draft (never auto-sends, never
 * clobbers a draft).
 */
import { getCurrentLang, t } from '@/shared/i18n.js';
import { getPrompt } from '@/shared/prompts';
import { create } from 'zustand';
import type { ChatMessage } from '@/shared/types';
import { openSuggestPort } from '@/platform/ports';
import * as core from '@/panel/state';
import { useComposerStore } from '@/panel/stores/composer-store';

interface SuggestState {
  byTab: Record<number, { loading: boolean; questions: string[] } | undefined>;
}

export const useSuggestStore = create<SuggestState>()(() => ({
  byTab: {},
}));

/** Ports: one at a time per tab; opening a new one drops the old. */
const _ports = new Map<number, chrome.runtime.Port>();

export function removeSuggestions(tabId: number): void {
  const port = _ports.get(tabId);
  if (port) {
    try { port.disconnect(); } catch { /* cleanup */ }
    _ports.delete(tabId);
  }
  useSuggestStore.setState(s => {
    if (!s.byTab[tabId]) return s;
    const byTab = { ...s.byTab };
    delete byTab[tabId];
    return { byTab };
  });
}

/** Drop a leading list marker ("1.", "2、", "-", "•") — content numbers stay. */
export function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:\d+\s*[.、)）:：]|[-*•])\s*/, '').trim();
}

function contentAsText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  const text = content.filter(p => p.type === 'text').map(p => (p.type === 'text' ? p.text : '')).join('\n');
  return text || t('chat.imageOnly');
}

/** Called by the stream controller when an answer completes for `tabId`. */
export function generateSuggestionsFor(tabId: number): void {
  if (!core.isSuggestQuestionsEnabled()) return;
  const ts = core.getStateForTab(tabId);
  if (!ts) return;

  removeSuggestions(tabId);
  useSuggestStore.setState(s => ({ byTab: { ...s.byTab, [tabId]: { loading: true, questions: [] } } }));

  const recentHistory = ts.conversationHistory.slice(-4);
  const userMessages = recentHistory.filter(m => m.role === 'user');
  const assistantMessages = recentHistory.filter(m => m.role === 'assistant');

  let userContent = '';
  const lastUser = userMessages[userMessages.length - 1];
  if (lastUser) userContent += getPrompt('suggest.userLabel', getCurrentLang()) + contentAsText(lastUser.content) + '\n\n';

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const assistantText = contentAsText(lastAssistant.content);
    const truncated = assistantText.length > 2000 ? `${assistantText.slice(0, 2000)}...` : assistantText;
    userContent += getPrompt('suggest.aiLabel', getCurrentLang()) + truncated;
  }

  const messages = [
    { role: 'system' as const, content: getPrompt('suggest', getCurrentLang()) },
    { role: 'user' as const, content: userContent },
  ];

  const port = openSuggestPort();
  _ports.set(tabId, port);

  let fullText = '';

  port.onDisconnect.addListener(() => {
    _ports.delete(tabId);
    useSuggestStore.setState(s => {
      const cur = s.byTab[tabId];
      if (!cur?.loading) return s;
      return { byTab: { ...s.byTab, [tabId]: { loading: false, questions: cur.questions } } };
    });
  });

  port.onMessage.addListener((msg: { type: string; content?: string }) => {
    if (msg.type === 'chunk') {
      fullText += msg.content || '';
    } else if (msg.type === 'done') {
      port.disconnect();
      _ports.delete(tabId);
      const questions = fullText
        .split('\n')
        .map(stripListMarker)
        .filter(q => q.length > 0)
        .slice(0, 3);
      useSuggestStore.setState(s => ({ byTab: { ...s.byTab, [tabId]: { loading: false, questions } } }));
    } else if (msg.type === 'error') {
      port.disconnect();
      _ports.delete(tabId);
      removeSuggestions(tabId);
    }
  });

  port.postMessage({ type: 'suggest', messages });
}

/** Chip click: fill the draft so the user can adjust before sending. */
export function fillDraftWith(question: string): void {
  useComposerStore.getState().appendDraftText(question);
}
