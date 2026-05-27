// chart-detector.js — 图表检测、截图截取及相关辅助函数

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

async function captureViaScreenshot({ pageX, pageY, pageW, pageH }, logTag) {
  const needsVerticalScroll = pageY < window.scrollY || pageY > window.scrollY + window.innerHeight || pageY + pageH > window.scrollY + window.innerHeight;
  const needsHorizontalScroll = pageX < window.scrollX || pageX > window.scrollX + window.innerWidth || pageX + pageW > window.scrollX + window.innerWidth;

  if (needsVerticalScroll || needsHorizontalScroll) {
    window.scrollTo({
      top: Math.max(0, pageY + pageH / 2 - window.innerHeight / 2),
      left: Math.max(0, pageX + pageW / 2 - window.innerWidth / 2),
      behavior: 'instant'
    });
    await new Promise(r => setTimeout(r, 150));
  }

  const msg = {
    action: 'captureChartScreenshot',
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    pageX, pageY, pageW, pageH,
    devicePixelRatio: window.devicePixelRatio || 1
  };
  console.log(logTag, 'sending captureChartScreenshot:', msg);
  let resp;
  try {
    resp = await chrome.runtime.sendMessage(msg);
  } catch (e) {
    console.error(logTag, 'captureChartScreenshot sendMessage error:', e.message);
    return null;
  }
  console.log(logTag, 'captureChartScreenshot response:', resp?.success, resp?.error || '');
  if (!resp?.success) return null;
  return resp.dataUri;
}

export function handleDetectCharts(_msg, sendResponse) {
  (async () => {
    try {
      const charts = [];
      const chartKeywords = /chart|graph|plot|diagram|figure/i;
      const MAX_IMAGES = 10;

      const canvasPromises = [];
      let filteredCanvasIndex = 0;
      document.querySelectorAll('canvas').forEach((canvas, _i) => {
        if (canvas.width > 80 && canvas.height > 40) {
          let thumb = '';
          try { thumb = canvas.toDataURL('image/png'); } catch { /* tainted canvas — cross-origin restriction */ }
          const rect = canvas.getBoundingClientRect();
          canvasPromises.push(
            createThumbnail(thumb, 120, 80).then(thumbnail => ({
              type: 'canvas', index: filteredCanvasIndex, width: canvas.width, height: canvas.height,
              thumbnail, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
              pageW: Math.round(rect.width), pageH: Math.round(rect.height)
            }))
          );
          filteredCanvasIndex++;
        }
      });
      const canvasResults = await Promise.all(canvasPromises);
      charts.push(...canvasResults);

      let filteredSvgIndex = 0;
      document.querySelectorAll('svg').forEach((svg) => {
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
            } catch { /* SVG serialization may fail for complex elements */ }
            const rect = svg.getBoundingClientRect();
            charts.push({
              type: 'svg', index: filteredSvgIndex, width: w, height: h,
              thumbnail, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
              pageW: Math.round(rect.width), pageH: Math.round(rect.height)
            });
            filteredSvgIndex++;
          }
        }
      });

      let imgCount = 0;
      let filteredImgIndex = 0;
      document.querySelectorAll('img').forEach((img) => {
        if (imgCount >= MAX_IMAGES) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w < 80 || h < 40) return;
        if (w / h > 5 || h / w > 5) return;

        const src = img.src || '';
        const alt = img.alt || '';
        const cls = img.className || '';
        const parent = img.closest('a, button, [role="link"], [role="button"]');
        const isLikelyIcon = w < 150 && h < 150;
        const isLikelyDecorative = parent && (w < 150 || h < 150);

        if (chartKeywords.test(src) || chartKeywords.test(alt) || chartKeywords.test(cls)) {
          const rect = img.getBoundingClientRect();
          charts.push({
            type: 'image', index: filteredImgIndex, width: w, height: h, src,
            thumbnail: src, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
            pageW: Math.round(rect.width), pageH: Math.round(rect.height)
          });
          imgCount++;
          filteredImgIndex++;
        } else if (!isLikelyIcon && !isLikelyDecorative && w >= 150 && h >= 80) {
          const rect = img.getBoundingClientRect();
          charts.push({
            type: 'image', index: filteredImgIndex, width: w, height: h, src,
            thumbnail: src, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY),
            pageW: Math.round(rect.width), pageH: Math.round(rect.height)
          });
          imgCount++;
          filteredImgIndex++;
        }
      });

      sendResponse({ success: true, charts });
    } catch (e) {
      sendResponse({ success: false, error: 'Failed to detect charts: ' + e.message });
    }
  })();
  return true;
}

export function handleCaptureChart(request, sendResponse) {
  const { type, index, src, pageX, pageY, pageW, pageH } = request;
  const _tag = '[AI Reader captureChart]';

  const tryCaptureElement = () => {
    if (type === 'canvas') {
      const validCanvases = Array.from(document.querySelectorAll('canvas'))
        .filter(c => c.width > 80 && c.height > 40);
      const canvas = validCanvases[index];
      if (!canvas) throw new Error('Canvas element not found at index ' + index);
      try { return canvas.toDataURL('image/png'); } catch (e) {
        console.warn(_tag, 'canvas.toDataURL failed (likely tainted):', e.message);
      }
      return null;
    }
    if (type === 'image') {
      const img = src
        ? document.querySelector(`img[src="${CSS.escape(src)}"]`)
        : document.querySelectorAll('img')[index];
      if (!img) throw new Error('Image element not found at index ' + index);
      console.log(_tag, 'image src:', img.src, 'crossOrigin:', img.crossOrigin,
        'naturalWidth:', img.naturalWidth, 'naturalHeight:', img.naturalHeight);
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/png');
      } catch (e) {
        console.warn(_tag, 'image canvas export failed (likely cross-origin):', e.message);
      }
      return null;
    }
    if (type === 'svg') {
      const validSvgs = Array.from(document.querySelectorAll('svg'))
        .filter(s => {
          const w = s.clientWidth || parseInt(s.getAttribute('width')) || 0;
          const h = s.clientHeight || parseInt(s.getAttribute('height')) || 0;
          return w > 80 && h > 40 && s.querySelector('path, rect, circle, line, polyline, polygon');
        });
      const svg = validSvgs[index];
      if (!svg) throw new Error('SVG element not found at index ' + index);
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
        image.onerror = (e) => {
          URL.revokeObjectURL(url);
          console.warn(_tag, 'SVG→Image render failed (foreignObject/external ref?):', e);
          resolve(null);
        };
        image.src = url;
      });
    }
    throw new Error('Unknown chart type: ' + type);
  };

  (async () => {
    try {
      console.log(_tag, 'capturing type:', type, 'index:', index,
        'pageX:', pageX, 'pageY:', pageY, 'pageW:', pageW, 'pageH:', pageH);
      let dataUri = await Promise.resolve(tryCaptureElement());
      console.log(_tag, 'tryCaptureElement result:', dataUri ? 'got dataUri (' + dataUri.length + ' chars)' : 'null');

      if (!dataUri && pageW && pageH) {
        console.log(_tag, 'falling back to captureViaScreenshot');
        dataUri = await captureViaScreenshot({ pageX, pageY, pageW, pageH }, _tag);
        console.log(_tag, 'captureViaScreenshot result:', dataUri ? 'got dataUri (' + dataUri.length + ' chars)' : 'null');
      }

      if (!dataUri) {
        console.error(_tag, 'all capture methods failed', { type, index, pageW, pageH });
        throw new Error('Failed to capture chart');
      }
      sendResponse({ success: true, dataUri });
    } catch (e) {
      console.error(_tag, 'capture failed:', e.message);
      sendResponse({ success: false, error: 'Failed to capture chart: ' + e.message });
    }
  })();

  return true;
}
