import type { ChatMessage } from '../shared/types';

type EventHandler = (...args: unknown[]) => void;

export const EVENTS = {
  RETRY: 'retry',
  EDIT: 'edit',
  REMOVE_SUGGEST_QUESTIONS: 'removeSuggestQuestions',
  REQUEST_RERENDER: 'requestRerender',
  GENERATE_SUGGESTIONS: 'generateSuggestions',
  CLEAR_QUOTE_PREVIEW: 'clearQuotePreview',
  PODCAST_CLICK: 'podcastClick',
  ADD_TTS_BUTTON: 'addTTSButton',
  SAVE_CURRENT_CHAT: 'saveCurrentChat',
  RENDER_HISTORY_LIST: 'renderHistoryList',
  SHOW_RELATED_PAGES: 'showRelatedPages',
  /** Fired by services/page-extractor after a successful extraction. The
   *  related-pages feature subscribes to it instead of being imported upward
   *  by the service layer. Payload: excerpt + url + title (+ body text) of the extracted page. */
  PAGE_EXTRACTED: 'pageExtracted',
  /** Fired by ui/tab-switch-handler after the chat area is rebuilt on a tab
   *  switch / re-render. The podcast feature subscribes to rebuild the full
   *  card if the now-playing podcast originated from the now-active tab. This
   *  keeps ui/** from importing the podcast feature directly. */
  PODCAST_REBUILD_REQUEST: 'podcastRebuildRequest',
  /** Fired by ui/tab-switch-handler after the chat area was rebuilt from
   *  history. The stream handler re-attaches an in-flight answer bubble for
   *  the now-active tab (and saves an answer that finished in the background). */
  CHAT_RERENDERED: 'chatRerendered',
  /** TTS playback is claiming the single audio resource — the podcast must
   *  stop. Emitted by services/tts (which cannot import the feature layer);
   *  mirrors the PODCAST_REBUILD_REQUEST decoupling. */
  PODCAST_STOP_REQUEST: 'podcastStopRequest',
  /** A citation chip ([#N]) in an answer was clicked. Payload: the paragraph index. */
  CITATION_CLICK: 'citationClick',
  /** F10: show another continuation of a branched conversation. */
  BRANCH_SWITCH: 'branchSwitch',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Typed event map — maps event names to their handler signatures */
interface EventMap {
  [EVENTS.RETRY]: (args: { wrapper: HTMLElement; rawText: string; rawDisplay: string; rawQuote?: string; msgId?: string }) => void;
  [EVENTS.EDIT]: (args: { wrapper: HTMLElement; originalRawText: string; editedText: string; rawQuote?: string; msgId?: string }) => void;
  [EVENTS.REMOVE_SUGGEST_QUESTIONS]: () => void;
  [EVENTS.REQUEST_RERENDER]: () => void;
  [EVENTS.GENERATE_SUGGESTIONS]: (args: { msgEl: HTMLElement; history: ChatMessage[] }) => void;
  [EVENTS.CLEAR_QUOTE_PREVIEW]: () => void;
  [EVENTS.PODCAST_CLICK]: () => void;
  [EVENTS.ADD_TTS_BUTTON]: (args: { msgEl: HTMLElement }) => void;
  [EVENTS.SAVE_CURRENT_CHAT]: () => void;
  [EVENTS.RENDER_HISTORY_LIST]: () => void;
  [EVENTS.SHOW_RELATED_PAGES]: () => void;
  [EVENTS.PAGE_EXTRACTED]: (args: { excerpt: string; url: string; title: string; content?: string }) => void;
  [EVENTS.PODCAST_REBUILD_REQUEST]: () => void;
  [EVENTS.CHAT_RERENDERED]: () => void;
  [EVENTS.PODCAST_STOP_REQUEST]: () => void;
  [EVENTS.CITATION_CLICK]: (args: { index: number }) => void;
  [EVENTS.BRANCH_SWITCH]: (args: { anchor: string; to: number }) => void;
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
