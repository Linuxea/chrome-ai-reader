// options.js — 设置页逻辑

const apiKeyInput = document.getElementById('apiKey');
const apiBaseInput = document.getElementById('apiBase');
const modelNameInput = document.getElementById('modelName');
const modelList = document.getElementById('model-list');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const systemPromptInput = document.getElementById('systemPrompt');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// 加载已保存的设置
chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName', 'systemPrompt'], (data) => {
  if (data.apiKey) {
    apiKeyInput.value = data.apiKey;
  }
  if (data.apiBase) {
    apiBaseInput.value = data.apiBase;
  }
  if (data.modelName) {
    modelNameInput.value = data.modelName;
  }
  if (data.systemPrompt) {
    systemPromptInput.value = data.systemPrompt;
  }
  // 有 apiKey 时自动获取模型列表
  if (data.apiKey) {
    fetchModels();
  }
});

// 获取模型列表（通过 service worker 中转）
async function fetchModels() {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || 'https://api.deepseek.com';

  if (!apiKey) {
    showStatus('请先填写 API Key', 'error');
    return;
  }

  refreshModelsBtn.disabled = true;
  refreshModelsBtn.textContent = '加载中...';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'fetchModels',
      apiBase,
      apiKey
    });

    modelList.innerHTML = '';
    if (response.success) {
      response.models.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        modelList.appendChild(option);
      });
      showStatus(`已获取 ${response.models.length} 个模型`, 'success');
    } else {
      showStatus(response.error || '获取模型列表失败', 'error');
    }
  } catch (e) {
    modelList.innerHTML = '';
    showStatus('获取模型列表失败：' + e.message, 'error');
  } finally {
    refreshModelsBtn.disabled = false;
    refreshModelsBtn.textContent = '刷新模型列表';
  }
}

refreshModelsBtn.addEventListener('click', fetchModels);

// 保存设置
saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim();
  const modelName = modelNameInput.value.trim();
  const systemPrompt = systemPromptInput.value.trim();

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
    chrome.storage.sync.remove('apiBase');
  }

  if (modelName) {
    data.modelName = modelName;
  } else {
    chrome.storage.sync.remove('modelName');
  }

  if (systemPrompt) {
    data.systemPrompt = systemPrompt;
  } else {
    chrome.storage.sync.remove('systemPrompt');
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
