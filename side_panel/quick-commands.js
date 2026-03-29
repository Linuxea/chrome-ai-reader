// quick-commands.js — 快捷指令弹出列表管理

// 快捷指令状态
let quickCommands = [];
const commandPopup = document.getElementById('commandPopup');
let commandPopupOpen = false;
let commandSelectedIndex = 0;

// 加载快捷指令
function loadQuickCommands() {
  chrome.storage.local.get(['quickCommands'], (data) => {
    quickCommands = data.quickCommands || [];
  });
}
loadQuickCommands();

// 监听快捷指令变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.quickCommands) {
    quickCommands = changes.quickCommands.newValue || [];
    if (commandPopupOpen) {
      updateCommandPopup(userInput.value);
    }
  }
});

// 获取筛选后的指令列表
function getFilteredCommands(input) {
  const query = input.slice(1).toLowerCase();
  if (!query) return quickCommands;
  return quickCommands.filter(cmd => cmd.name.toLowerCase().includes(query));
}

// 更新弹出列表
function updateCommandPopup(input) {
  const filtered = getFilteredCommands(input);
  if (filtered.length === 0 && quickCommands.length === 0) {
    hideCommandPopup();
    return;
  }
  commandSelectedIndex = 0;
  commandPopupOpen = true;
  renderCommandPopup(filtered);
}

// 渲染弹出列表
function renderCommandPopup(filtered) {
  commandPopup.classList.remove('hidden');

  if (filtered.length === 0) {
    commandPopup.innerHTML = '<div class="command-popup-empty">无匹配的快捷指令</div>';
    return;
  }

  commandPopup.innerHTML = filtered.map((cmd, idx) => {
    const preview = cmd.prompt.length > 30 ? cmd.prompt.slice(0, 30) + '...' : cmd.prompt;
    return `<div class="command-popup-item${idx === commandSelectedIndex ? ' selected' : ''}" data-idx="${idx}">
      <span class="command-popup-item-name">/${escapeHtml(cmd.name)}</span>
      <span class="command-popup-item-preview">${escapeHtml(preview)}</span>
    </div>`;
  }).join('');
}

// 隐藏弹出列表
function hideCommandPopup() {
  commandPopupOpen = false;
  commandSelectedIndex = 0;
  commandPopup.classList.add('hidden');
}

// 点击指令项
commandPopup.addEventListener('click', (e) => {
  const item = e.target.closest('.command-popup-item');
  if (!item) return;
  const idx = parseInt(item.dataset.idx);
  const filtered = getFilteredCommands(userInput.value);
  if (filtered[idx]) {
    executeQuickCommand(filtered[idx]);
  }
});

// 点击外部关闭
document.addEventListener('click', (e) => {
  if (commandPopupOpen && !commandPopup.contains(e.target) && e.target !== userInput) {
    hideCommandPopup();
  }
});

// 执行快捷指令
async function executeQuickCommand(cmd) {
  if (isGenerating) return;

  hideCommandPopup();
  userInput.value = '';
  await sendToAI(cmd.prompt, `/${cmd.name}`);
}
