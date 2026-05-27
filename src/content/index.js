// content.js — content script 入口，消息路由 + 选区监听
import { handleExtract } from './page-extractor.js';
import { handleDetectCharts, handleCaptureChart } from './chart-detector.js';

// 消息路由：根据 action 分发到对应 handler
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const handlers = {
    extract: handleExtract,
    detectCharts: handleDetectCharts,
    captureChart: handleCaptureChart,
  };
  const handler = handlers[request.action];
  if (handler) return handler(request, sendResponse);
});

// 检测扩展上下文是否已失效（扩展被重新加载/更新时会发生）
function isContextValid() {
  return !!chrome.runtime?.id;
}

// 选区变化监听（防抖推送）
let selectionTimer = null;

document.addEventListener('selectionchange', () => {
  if (!isContextValid()) return;
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    if (!isContextValid()) return;
    const text = window.getSelection().toString().trim();
    try {
      chrome.runtime.sendMessage({
        action: 'selectionChanged',
        text: text
      }).catch(() => {
        // side panel 未打开或扩展已失效时静默忽略
      });
    } catch {
      // 扩展上下文已失效，静默忽略
    }
  }, 300);
});
