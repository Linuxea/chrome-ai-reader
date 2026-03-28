// options.js — 设置页逻辑

const apiKeyInput = document.getElementById('apiKey');
const apiBaseInput = document.getElementById('apiBase');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// 加载已保存的设置
chrome.storage.sync.get(['apiKey', 'apiBase'], (data) => {
  if (data.apiKey) {
    apiKeyInput.value = data.apiKey;
  }
  if (data.apiBase) {
    apiBaseInput.value = data.apiBase;
  }
});

// 保存设置
saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim();

  if (!apiKey) {
    showStatus('请输入 API Key', 'error');
    return;
  }

  if (!apiKey.startsWith('sk-') && !apiBase) {
    showStatus('提示：标准 OpenAI Key 以 sk- 开头。如使用第三方 API，请同时填写 API 地址', 'error');
    return;
  }

  const data = { apiKey };
  if (apiBase) {
    data.apiBase = apiBase;
  } else {
    // 清除之前保存的自定义地址
    chrome.storage.sync.remove('apiBase');
  }

  chrome.storage.sync.set(data, () => {
    showStatus('设置已保存', 'success');
  });
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 3000);
}
