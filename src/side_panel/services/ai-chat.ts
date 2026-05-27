import { initStreamHandler } from './stream-handler';
import { initQuickActionHandler, handleQuickAction } from './quick-action-handler';
import { initMessageSender, sendToAI, sendMessage, retryMessage } from './message-sender';
import { extractPageContent } from './page-extractor';

let _userInput: HTMLTextAreaElement;
let _sendBtn: HTMLButtonElement;
let _actionBtns: NodeListOf<HTMLButtonElement>;

type CommandFn = () => void;
type GetFilteredCommandsFn = (value: string) => { name: string; prompt: string }[];
type RenderCommandPopupFn = (filtered: { name: string; prompt: string }[]) => void;
type GetIndexFn = () => number;
type SetIndexFn = (i: number) => void;
type ExecuteQuickCommandFn = (cmd: { name: string; prompt: string }) => void;

interface AIChatDeps {
  chatArea: HTMLElement;
  userInput: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  actionBtns: NodeListOf<HTMLButtonElement>;
  isCommandPopupOpen: () => boolean;
  getFilteredCommands: GetFilteredCommandsFn;
  renderCommandPopup: RenderCommandPopupFn;
  hideCommandPopup: CommandFn;
  executeQuickCommand: ExecuteQuickCommandFn;
  getCommandSelectedIndex: GetIndexFn;
  setCommandSelectedIndex: SetIndexFn;
}

export function initAIChat({
  chatArea, userInput, sendBtn, actionBtns,
  isCommandPopupOpen, getFilteredCommands, renderCommandPopup, hideCommandPopup, executeQuickCommand,
  getCommandSelectedIndex, setCommandSelectedIndex,
}: AIChatDeps): void {
  _userInput = userInput;
  _sendBtn = sendBtn;
  _actionBtns = actionBtns;

  initStreamHandler({ chatArea });
  initMessageSender({ chatArea, userInput });
  initQuickActionHandler({ sendToAI });

  _sendBtn.addEventListener('click', sendMessage);
  _userInput.addEventListener('keydown', (e: KeyboardEvent) =>
    handleKeydown(e, isCommandPopupOpen, getFilteredCommands, renderCommandPopup, hideCommandPopup, executeQuickCommand, getCommandSelectedIndex, setCommandSelectedIndex));
  _actionBtns.forEach(btn => {
    btn.addEventListener('click', () => handleQuickAction(btn.dataset.action || ''));
  });
}

function handleKeydown(
  e: KeyboardEvent,
  isCommandPopupOpen: () => boolean,
  getFilteredCommands: GetFilteredCommandsFn,
  renderCommandPopup: RenderCommandPopupFn,
  hideCommandPopup: CommandFn,
  executeQuickCommand: ExecuteQuickCommandFn,
  getCommandSelectedIndex: GetIndexFn,
  setCommandSelectedIndex: SetIndexFn,
): void {
  if (isCommandPopupOpen()) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const filtered = getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        setCommandSelectedIndex((getCommandSelectedIndex() + 1) % filtered.length);
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const filtered = getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        setCommandSelectedIndex((getCommandSelectedIndex() - 1 + filtered.length) % filtered.length);
        renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filtered = getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        executeQuickCommand(filtered[getCommandSelectedIndex()]);
      } else {
        hideCommandPopup();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideCommandPopup();
      return;
    }
  }

  if (!isCommandPopupOpen() && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

export { sendToAI, sendMessage, retryMessage, extractPageContent };
