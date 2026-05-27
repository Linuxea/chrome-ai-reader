// services/ai-chat.js — Facade：聚合子模块，保持外部导入接口不变

import { initStreamHandler } from './stream-handler.js';
import { initQuickActionHandler, handleQuickAction } from './quick-action-handler.js';
import { initMessageSender, sendToAI, sendMessage, retryMessage } from './message-sender.js';
import { extractPageContent } from './page-extractor.js';

let _userInput;
let _sendBtn;
let _actionBtns;

// Quick-command helpers injected from features layer
let _isCommandPopupOpen;
let _getFilteredCommands;
let _renderCommandPopup;
let _hideCommandPopup;
let _executeQuickCommand;
let _getCommandSelectedIndex;
let _setCommandSelectedIndex;

export function initAIChat({ chatArea, userInput, sendBtn, actionBtns,
  isCommandPopupOpen, getFilteredCommands, renderCommandPopup, hideCommandPopup, executeQuickCommand,
  getCommandSelectedIndex, setCommandSelectedIndex }) {
  _userInput = userInput;
  _sendBtn = sendBtn;
  _actionBtns = actionBtns;

  // Command popup helpers (injected from features layer to avoid layer violation)
  _isCommandPopupOpen = isCommandPopupOpen;
  _getFilteredCommands = getFilteredCommands;
  _renderCommandPopup = renderCommandPopup;
  _hideCommandPopup = hideCommandPopup;
  _executeQuickCommand = executeQuickCommand;
  _getCommandSelectedIndex = getCommandSelectedIndex;
  _setCommandSelectedIndex = setCommandSelectedIndex;

  // 初始化子模块
  initStreamHandler({ chatArea });
  initMessageSender({ chatArea, userInput });
  initQuickActionHandler({ sendToAI });

  // Event bindings
  _sendBtn.addEventListener('click', sendMessage);
  _userInput.addEventListener('keydown', handleKeydown);
  _actionBtns.forEach(btn => {
    btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
  });
}

function handleKeydown(e) {
  if (_isCommandPopupOpen()) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        _setCommandSelectedIndex((_getCommandSelectedIndex() + 1) % filtered.length);
        _renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        _setCommandSelectedIndex((_getCommandSelectedIndex() - 1 + filtered.length) % filtered.length);
        _renderCommandPopup(filtered);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filtered = _getFilteredCommands(_userInput.value);
      if (filtered.length > 0) {
        _executeQuickCommand(filtered[_getCommandSelectedIndex()]);
      } else {
        _hideCommandPopup();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _hideCommandPopup();
      return;
    }
  }

  // Enter 发送
  if (!_isCommandPopupOpen() && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// Re-export 保持外部导入接口不变
export { sendToAI, sendMessage, retryMessage, extractPageContent };
