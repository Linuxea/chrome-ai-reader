// content.js -- 页面内容提取
// 使用 Mozilla Readability 提取当前页面正文

import { Readability } from '@mozilla/readability';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    try {
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (article) {
        sendResponse({
          success: true,
          data: {
            title: article.title || document.title || '',
            textContent: article.textContent || '',
            excerpt: article.excerpt || '',
            content: article.content || '',
            byline: article.byline || '',
            siteName: article.siteName || ''
          }
        });
      } else {
        // Readability 解析失败时回退到 body 文本
        sendResponse({
          success: true,
          data: {
            title: document.title || '',
            textContent: document.body.innerText || '',
            excerpt: '',
            content: '',
            byline: '',
            siteName: ''
          }
        });
      }
    } catch (e) {
      sendResponse({
        success: false,
        error: 'Failed to extract page content: ' + e.message
      });
    }
    return true;
  }

  if (request.action === 'detectCharts') {
    try {
      const charts = [];
      const chartKeywords = /chart|graph|plot|diagram|figure/i;

      document.querySelectorAll('canvas').forEach((canvas, i) => {
        if (canvas.width > 100 && canvas.height > 50) {
          charts.push({ type: 'canvas', index: i, width: canvas.width, height: canvas.height });
        }
      });

      document.querySelectorAll('svg').forEach((svg, i) => {
        const w = svg.clientWidth || parseInt(svg.getAttribute('width')) || 0;
        const h = svg.clientHeight || parseInt(svg.getAttribute('height')) || 0;
        if (w > 100 && h > 50) {
          const hasChartChildren = svg.querySelector('path, rect, circle, line, polyline, polygon');
          if (hasChartChildren) {
            charts.push({ type: 'svg', index: i, width: w, height: h });
          }
        }
      });

      document.querySelectorAll('img').forEach((img, i) => {
        if (img.naturalWidth > 100 && img.naturalHeight > 50) {
          const src = img.src || '';
          const alt = img.alt || '';
          const cls = img.className || '';
          if (chartKeywords.test(src) || chartKeywords.test(alt) || chartKeywords.test(cls)) {
            charts.push({ type: 'image', index: i, width: img.naturalWidth, height: img.naturalHeight, src });
          }
        }
      });

      sendResponse({ success: true, charts });
    } catch (e) {
      sendResponse({ success: false, error: 'Failed to detect charts: ' + e.message });
    }
    return true;
  }

  if (request.action === 'captureChart') {
    const { type, index } = request;

    try {
      if (type === 'canvas') {
        const canvas = document.querySelectorAll('canvas')[index];
        if (!canvas) {
          sendResponse({ success: false, error: 'Canvas element not found' });
          return true;
        }
        sendResponse({ success: true, dataUri: canvas.toDataURL('image/png') });
        return true;
      }

      if (type === 'image') {
        const img = document.querySelectorAll('img')[index];
        if (!img) {
          sendResponse({ success: false, error: 'Image element not found' });
          return true;
        }
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        sendResponse({ success: true, dataUri: canvas.toDataURL('image/png') });
        return true;
      }

      if (type === 'svg') {
        const svg = document.querySelectorAll('svg')[index];
        if (!svg) {
          sendResponse({ success: false, error: 'SVG element not found' });
          return true;
        }
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width || svg.clientWidth || 300;
          canvas.height = image.height || svg.clientHeight || 150;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0);
          URL.revokeObjectURL(url);
          sendResponse({ success: true, dataUri: canvas.toDataURL('image/png') });
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          sendResponse({ success: false, error: 'Failed to load SVG as image' });
        };
        image.src = url;
        return true;
      }

      sendResponse({ success: false, error: 'Unknown chart type: ' + type });
    } catch (e) {
      sendResponse({ success: false, error: 'Failed to capture chart: ' + e.message });
    }
    return true;
  }
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
