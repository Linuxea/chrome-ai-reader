import type { ChatMessage } from '../shared/types';

type EventHandler = (...args: unknown[]) => void;

export const EVENTS = {
  RETRY: 'retry',
  REMOVE_SUGGEST_QUESTIONS: 'removeSuggestQuestions',
  REQUEST_RERENDER: 'requestRerender',
  GENERATE_SUGGESTIONS: 'generateSuggestions',
  GENERATE_OUTLINE: 'generateOutline',
  CLEAR_QUOTE_PREVIEW: 'clearQuotePreview',
  CHART_CLICK: 'chartClick',
  PODCAST_CLICK: 'podcastClick',
  ADD_TTS_BUTTON: 'addTTSButton',
  SAVE_CURRENT_CHAT: 'saveCurrentChat',
  RENDER_HISTORY_LIST: 'renderHistoryList',
  SHOW_RELATED_PAGES: 'showRelatedPages',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Typed event map — maps event names to their handler signatures */
interface EventMap {
  [EVENTS.RETRY]: (args: { wrapper: HTMLElement; rawText: string; rawDisplay: string; rawQuote?: string }) => void;
  [EVENTS.REMOVE_SUGGEST_QUESTIONS]: () => void;
  [EVENTS.REQUEST_RERENDER]: () => void;
  [EVENTS.GENERATE_SUGGESTIONS]: (args: { msgEl: HTMLElement; history: ChatMessage[] }) => void;
  [EVENTS.GENERATE_OUTLINE]: () => void;
  [EVENTS.CLEAR_QUOTE_PREVIEW]: () => void;
  [EVENTS.CHART_CLICK]: () => void;
  [EVENTS.PODCAST_CLICK]: () => void;
  [EVENTS.ADD_TTS_BUTTON]: (args: { msgEl: HTMLElement }) => void;
  [EVENTS.SAVE_CURRENT_CHAT]: () => void;
  [EVENTS.RENDER_HISTORY_LIST]: () => void;
  [EVENTS.SHOW_RELATED_PAGES]: () => void;
}

const handlers = new Map<string, Set<EventHandler>>();

export function on<K extends EventName>(event: K, handler: EventMap[K]): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler as EventHandler);
  return () => handlers.get(event)?.delete(handler as EventHandler);
}

export function off(event: EventName, handler: EventMap[EventName]): void {
  handlers.get(event)?.delete(handler as EventHandler);
}

export function emit<K extends EventName>(event: K, ...args: Parameters<EventMap[K]>): void {
  handlers.get(event)?.forEach(fn => fn(...args));
}
