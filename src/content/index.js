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
    (async () => {
      try {
        const charts = [];
        const chartKeywords = /chart|graph|plot|diagram|figure/i;
        const MAX_IMAGES = 10;

        const canvasPromises = [];
        document.querySelectorAll('canvas').forEach((canvas, i) => {
          if (canvas.width > 80 && canvas.height > 40) {
            let thumb = '';
            try { thumb = canvas.toDataURL('image/png'); } catch {}
            const rect = canvas.getBoundingClientRect();
            canvasPromises.push(
              createThumbnail(thumb, 120, 80).then(thumbnail => ({
                type: 'canvas', index: i, width: canvas.width, height: canvas.height,
                thumbnail, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
                pageW: Math.round(rect.width), pageH: Math.round(rect.height)
              }))
            );
          }
        });
        const canvasResults = await Promise.all(canvasPromises);
        charts.push(...canvasResults);

      document.querySelectorAll('svg').forEach((svg, i) => {
        const w = svg.clientWidth || parseInt(svg.getAttribute('width')) || 0;
        const h = svg.clientHeight || parseInt(svg.getAttribute('height')) || 0;
        if (w > 80 && h > 40) {
          const hasChartChildren = svg.querySelector('path, rect, circle, line, polyline, polygon');
          if (hasChartChildren) {
            let thumbnail = '';
            try {
              const serializer = new XMLSerializer();
              const svgStr = serializer.serializeToString(svg);
              thumbnail = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
            } catch {}
            const rect = svg.getBoundingClientRect();
            charts.push({
              type: 'svg', index: i, width: w, height: h,
              thumbnail, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
              pageW: Math.round(rect.width), pageH: Math.round(rect.height)
            });
          }
        }
      });

      let imgCount = 0;
      document.querySelectorAll('img').forEach((img, i) => {
        if (imgCount >= MAX_IMAGES) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w < 80 || h < 40) return;
        if (w / h > 5 || h / w > 5) return;

        const src = img.src || '';
        const alt = img.alt || '';
        const cls = img.className || '';
        const parent = img.closest('a, button, [role="link"], [role="button"]');
        const isLikelyIcon = w < 80 && h < 80;
        const isLikelyDecorative = parent && (w < 150 || h < 150);

        if (chartKeywords.test(src) || chartKeywords.test(alt) || chartKeywords.test(cls)) {
          const rect = img.getBoundingClientRect();
          charts.push({
            type: 'image', index: i, width: w, height: h, src,
            thumbnail: src, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
            pageW: Math.round(rect.width), pageH: Math.round(rect.height)
          });
          imgCount++;
        } else if (!isLikelyIcon && !isLikelyDecorative && w >= 150 && h >= 80) {
          const rect = img.getBoundingClientRect();
          charts.push({
            type: 'image', index: i, width: w, height: h, src,
            thumbnail: src, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
            pageW: Math.round(rect.width), pageH: Math.round(rect.height)
          });
          imgCount++;
        }
      });

      sendResponse({ success: true, charts });
      } catch (e) {
        sendResponse({ success: false, error: 'Failed to detect charts: ' + e.message });
      }
    })();
    return true;
  }

  if (request.action === 'captureChart') {
    const { type, index, pageX, pageY, pageW, pageH } = request;

    const tryCaptureElement = () => {
      if (type === 'canvas') {
        const canvas = document.querySelectorAll('canvas')[index];
        if (!canvas) throw new Error('Canvas element not found');
        try { return canvas.toDataURL('image/png'); } catch {}
        return null;
      }
      if (type === 'image') {
        const img = document.querySelectorAll('img')[index];
        if (!img) throw new Error('Image element not found');
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          return c.toDataURL('image/png');
        } catch {}
        return null;
      }
      if (type === 'svg') {
        const svg = document.querySelectorAll('svg')[index];
        if (!svg) throw new Error('SVG element not found');
        return new Promise((resolve) => {
          const svgStr = new XMLSerializer().serializeToString(svg);
          const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const image = new Image();
          image.onload = () => {
            const c = document.createElement('canvas');
            c.width = image.width || svg.clientWidth || 300;
            c.height = image.height || svg.clientHeight || 150;
            c.getContext('2d').drawImage(image, 0, 0);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/png'));
          };
          image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          image.src = url;
        });
      }
      throw new Error('Unknown chart type: ' + type);
    };

    (async () => {
      try {
        let dataUri = await Promise.resolve(tryCaptureElement());

        if (!dataUri && pageW && pageH) {
          dataUri = await captureViaScreenshot({ pageX, pageY, pageW, pageH });
        }

        if (!dataUri) throw new Error('Failed to capture chart');
        sendResponse({ success: true, dataUri });
      } catch (e) {
        sendResponse({ success: false, error: 'Failed to capture chart: ' + e.message });
      }
    })();

    return true;
  }
});

// 检测扩展上下文是否已失效（扩展被重新加载/更新时会发生）
function isContextValid() {
  return !!chrome.runtime?.id;
}

function createThumbnail(dataUri, maxW, maxH) {
  if (!dataUri) return Promise.resolve('');
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', 0.6)); } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUri;
  });
}

async function captureViaScreenshot({ pageX, pageY, pageW, pageH }) {
  const resp = await chrome.runtime.sendMessage({
    action: 'captureChartScreenshot',
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    pageX, pageY, pageW, pageH,
    devicePixelRatio: window.devicePixelRatio || 1
  });
  if (!resp?.success) return null;
  return resp.dataUri;
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
