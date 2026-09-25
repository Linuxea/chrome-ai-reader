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
  isTTSPlaying: () => boolean;
  stopTTS: () => void;
}
