import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import * as state from '../state';
import type { QuickCommand } from '../state';

let _userInput: HTMLTextAreaElement;
let _commandPopup: HTMLElement;
let _sendToAI: (text: string, displayText: string) => Promise<void>;

let commandPopupOpen = false;
let commandSelectedIndex = 0;

export function initQuickCommands({ userInput, commandPopup, onSendToAI }: {
  userInput: HTMLTextAreaElement;
  commandPopup: HTMLElement;
  onSendToAI: (text: string, displayText: string) => Promise<void>;
}): void {
  _userInput = userInput;
  _commandPopup = commandPopup;
  _sendToAI = onSendToAI;

  chrome.storage.local.get(['quickCommands'], (data) => {
    state.setQuickCommands((data.quickCommands as QuickCommand[]) || []);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.quickCommands) {
      state.setQuickCommands((changes.quickCommands.newValue as QuickCommand[]) || []);
      if (commandPopupOpen) {
        updateCommandPopup(_userInput.value);
      }
    }
  });

  _commandPopup.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.command-popup-item') as HTMLElement | null;
    if (!item) return;
    const idx = parseInt(item.dataset.idx!);
    const filtered = getFilteredCommands(_userInput.value);
    if (filtered[idx]) {
      executeQuickCommand(filtered[idx]);
    }
  });

  document.addEventListener('click', (e) => {
    if (commandPopupOpen && !_commandPopup.contains(e.target as Node) && e.target !== _userInput) {
      hideCommandPopup();
    }
  });
}

export function isCommandPopupOpen(): boolean {
  return commandPopupOpen;
}

export function getCommandSelectedIndex(): number {
  return commandSelectedIndex;
}

export function setCommandSelectedIndex(v: number): void {
  commandSelectedIndex = v;
}

export function getFilteredCommands(input: string): QuickCommand[] {
  const query = input.slice(1).toLowerCase();
  const quickCommands = state.getQuickCommands();
  if (!query) return quickCommands;
  return quickCommands.filter(cmd => cmd.name.toLowerCase().includes(query));
}

export function updateCommandPopup(input: string): void {
  const filtered = getFilteredCommands(input);
  const quickCommands = state.getQuickCommands();
  if (filtered.length === 0 && quickCommands.length === 0) {
    hideCommandPopup();
    return;
  }
  commandSelectedIndex = 0;
  commandPopupOpen = true;
  renderCommandPopup(filtered);
}

export function renderCommandPopup(filtered: QuickCommand[]): void {
  _commandPopup.classList.remove('hidden');

  if (filtered.length === 0) {
    _commandPopup.innerHTML = `<div class="command-popup-empty">${t('cmd.noMatch')}</div>`;
    return;
  }

  _commandPopup.innerHTML = filtered.map((cmd, idx) => {
    const preview = cmd.prompt.length > 30 ? cmd.prompt.slice(0, 30) + '...' : cmd.prompt;
    return `<div class="command-popup-item${idx === commandSelectedIndex ? ' selected' : ''}" data-idx="${idx}">
      <span class="command-popup-item-name">/${escapeHtml(cmd.name)}</span>
      <span class="command-popup-item-preview">${escapeHtml(preview)}</span>
    </div>`;
  }).join('');
}

export function hideCommandPopup(): void {
  commandPopupOpen = false;
  commandSelectedIndex = 0;
  _commandPopup.classList.add('hidden');
}

export function executeQuickCommand(cmd: QuickCommand): void {
  if (state.getIsGenerating()) return;

  hideCommandPopup();
  _userInput.value = '';
  _sendToAI(cmd.prompt, `/${cmd.name}`);
}
