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
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

const handlers = new Map<string, Set<EventHandler>>();

export function on(event: string, handler: EventHandler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => handlers.get(event)?.delete(handler);
}

export function off(event: string, handler: EventHandler): void {
  handlers.get(event)?.delete(handler);
}

export function emit(event: string, ...args: unknown[]): void {
  handlers.get(event)?.forEach(fn => fn(...args));
}
