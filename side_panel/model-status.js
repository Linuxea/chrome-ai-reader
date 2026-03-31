// model-status.js — 模型状态栏

const modelStatusBar = document.getElementById('modelStatusBar');

function updateModelStatusBar(name) {
  modelStatusBar.textContent = t('sidebar.modelStatus') + (name || 'deepseek-chat');
}

chrome.storage.sync.get(['modelName'], (data) => {
  updateModelStatusBar(data.modelName);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.modelName) {
    updateModelStatusBar(changes.modelName.newValue);
  }
});
