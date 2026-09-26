/** Element + dependency bags the shell modules share (kept apart so they import no module of each other for types). */

export interface UIElements {
  settingsBtn: HTMLElement;
  newChatBtn: HTMLElement;
  exportBtn: HTMLElement;
  historyBtn: HTMLElement;
  historyBackBtn: HTMLElement;
  quoteClose: HTMLElement;
  chatArea: HTMLElement;
  quoteText: HTMLElement;
  quotePreview: HTMLElement;
  historyPanel: HTMLElement;
  historyList: HTMLElement;
  userInput: HTMLTextAreaElement;
}

export interface GlobalEventDeps {
  removeSuggestQuestions: () => void;
  /** Tab switch / chat load: window-global TTS keeps playing; only its DOM
   *  anchor is detached (CHAT_RERENDERED re-attaches on return). */
  detachTTS: () => void;
}
