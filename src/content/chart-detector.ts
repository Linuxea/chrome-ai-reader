function createThumbnail(dataUri: string, maxW: number, maxH: number): Promise<string> {
  if (!dataUri) return Promise.resolve('');
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', 0.6)); } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUri;
  });
}

interface Rect { pageX: number; pageY: number; pageW: number; pageH: number; }

async function captureViaScreenshot({ pageX, pageY, pageW, pageH }: Rect, logTag: string): Promise<string | null> {
  const needsVerticalScroll = pageY < window.scrollY || pageY > window.scrollY + window.innerHeight || pageY + pageH > window.scrollY + window.innerHeight;
  const needsHorizontalScroll = pageX < window.scrollX || pageX > window.scrollX + window.innerWidth || pageX + pageW > window.scrollX + window.innerWidth;
  if (needsVerticalScroll || needsHorizontalScroll) {
    window.scrollTo({ top: Math.max(0, pageY + pageH / 2 - window.innerHeight / 2), left: Math.max(0, pageX + pageW / 2 - window.innerWidth / 2), behavior: 'instant' });
    await new Promise(r => setTimeout(r, 150));
  }
  let resp: { success?: boolean; error?: string; dataUri?: string } | null = null;
  try { resp = await chrome.runtime.sendMessage({ action: 'captureChartScreenshot', scrollX: window.scrollX, scrollY: window.scrollY, pageX, pageY, pageW, pageH, devicePixelRatio: window.devicePixelRatio || 1 }); } catch (e: unknown) { console.error(logTag, 'captureChartScreenshot error:', (e as Error).message); return null; }
  if (!resp?.success) return null;
  return resp.dataUri || null;
}

interface ChartInfo { type: string; index: number; width: number; height: number; thumbnail?: string; src?: string; pageX: number; pageY: number; pageW: number; pageH: number; }

export function handleDetectCharts(_msg: unknown, sendResponse: (r: { success: boolean; charts?: ChartInfo[]; error?: string }) => void): true {
  (async () => {
    try {
      const charts: ChartInfo[] = [];
      const chartKeywords = /chart|graph|plot|diagram|figure/i;
      const MAX_IMAGES = 10;

      const canvasPromises: Promise<ChartInfo>[] = [];
      let filteredCanvasIndex = 0;
      document.querySelectorAll('canvas').forEach((canvas) => {
        if (canvas.width > 80 && canvas.height > 40) {
          let thumb = '';
          try { thumb = canvas.toDataURL('image/png'); } catch { /* tainted canvas */ }
          const rect = canvas.getBoundingClientRect();
          canvasPromises.push(createThumbnail(thumb, 120, 80).then(thumbnail => ({ type: 'canvas', index: filteredCanvasIndex, width: canvas.width, height: canvas.height, thumbnail, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY), pageW: Math.round(rect.width), pageH: Math.round(rect.height) })));
          filteredCanvasIndex++;
        }
      });
      charts.push(...await Promise.all(canvasPromises));

      let filteredSvgIndex = 0;
      document.querySelectorAll('svg').forEach((svg) => {
        const w = svg.clientWidth || parseInt(svg.getAttribute('width') || '0') || 0;
        const h = svg.clientHeight || parseInt(svg.getAttribute('height') || '0') || 0;
        if (w > 80 && h > 40 && svg.querySelector('path, rect, circle, line, polyline, polygon')) {
          let thumbnail = '';
          try { const svgStr = new XMLSerializer().serializeToString(svg); thumbnail = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr))); } catch { /* SVG serialization may fail */ }
          const rect = svg.getBoundingClientRect();
          charts.push({ type: 'svg', index: filteredSvgIndex, width: w, height: h, thumbnail, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY), pageW: Math.round(rect.width), pageH: Math.round(rect.height) });
          filteredSvgIndex++;
        }
      });

      let imgCount = 0; let filteredImgIndex = 0;
      document.querySelectorAll('img').forEach((img) => {
        if (imgCount >= MAX_IMAGES) return;
        const w = img.naturalWidth || img.width || 0; const h = img.naturalHeight || img.height || 0;
        if (w < 80 || h < 40 || w / h > 5 || h / w > 5) return;
        const src = img.src || ''; const alt = img.alt || ''; const cls = img.className || '';
        const parent = img.closest('a, button, [role="link"], [role="button"]');
        const isLikelyIcon = w < 150 && h < 150; const isLikelyDecorative = parent && (w < 150 || h < 150);
        if (chartKeywords.test(src) || chartKeywords.test(alt) || chartKeywords.test(cls)) {
          const rect = img.getBoundingClientRect();
          charts.push({ type: 'image', index: filteredImgIndex, width: w, height: h, src, thumbnail: src, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY), pageW: Math.round(rect.width), pageH: Math.round(rect.height) }); imgCount++; filteredImgIndex++;
        } else if (!isLikelyIcon && !isLikelyDecorative && w >= 150 && h >= 80) {
          const rect = img.getBoundingClientRect();
          charts.push({ type: 'image', index: filteredImgIndex, width: w, height: h, src, thumbnail: src, pageX: Math.round(rect.left + window.scrollX), pageY: Math.round(rect.top + window.scrollY), pageW: Math.round(rect.width), pageH: Math.round(rect.height) }); imgCount++; filteredImgIndex++;
        }
      });

      sendResponse({ success: true, charts });
    } catch (e: unknown) { sendResponse({ success: false, error: 'Failed to detect charts: ' + (e as Error).message }); }
  })();
  return true;
}

export function handleCaptureChart(request: { type: string; index: number; src?: string | null; pageX: number; pageY: number; pageW: number; pageH: number }, sendResponse: (r: { success: boolean; dataUri?: string; error?: string }) => void): true {
  const { type, index, src, pageX, pageY, pageW, pageH } = request;
  const _tag = '[AI Reader captureChart]';

  const tryCaptureElement = (): string | null | Promise<string | null> => {
    if (type === 'canvas') {
      const validCanvases = Array.from(document.querySelectorAll('canvas')).filter(c => c.width > 80 && c.height > 40);
      const canvas = validCanvases[index];
      if (!canvas) throw new Error('Canvas element not found at index ' + index);
      try { return canvas.toDataURL('image/png'); } catch (e: unknown) { console.warn(_tag, 'canvas.toDataURL failed:', (e as Error).message); }
      return null;
    }
    if (type === 'image') {
      const img = (src ? document.querySelector(`img[src="${CSS.escape(src)}"]`) : document.querySelectorAll('img')[index]) as HTMLImageElement | null | undefined;
      if (!img) throw new Error('Image element not found at index ' + index);
      try { const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height; c.getContext('2d')!.drawImage(img, 0, 0); return c.toDataURL('image/png'); } catch (e: unknown) { console.warn(_tag, 'image canvas export failed:', (e as Error).message); }
      return null;
    }
    if (type === 'svg') {
      const validSvgs = Array.from(document.querySelectorAll('svg')).filter(s => { const w = s.clientWidth || parseInt(s.getAttribute('width') || '0') || 0; const h = s.clientHeight || parseInt(s.getAttribute('height') || '0') || 0; return w > 80 && h > 40 && s.querySelector('path, rect, circle, line, polyline, polygon'); });
      const svg = validSvgs[index];
      if (!svg) throw new Error('SVG element not found at index ' + index);
      return new Promise((resolve) => {
        const svgStr = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => { const c = document.createElement('canvas'); c.width = image.width || svg.clientWidth || 300; c.height = image.height || svg.clientHeight || 150; c.getContext('2d')!.drawImage(image, 0, 0); URL.revokeObjectURL(url); resolve(c.toDataURL('image/png')); };
        image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        image.src = url;
      });
    }
    throw new Error('Unknown chart type: ' + type);
  };

  (async () => {
    try {
      let dataUri = await Promise.resolve(tryCaptureElement());
      if (!dataUri && pageW && pageH) dataUri = await captureViaScreenshot({ pageX, pageY, pageW, pageH }, _tag);
      if (!dataUri) throw new Error('Failed to capture chart');
      sendResponse({ success: true, dataUri });
    } catch (e: unknown) { sendResponse({ success: false, error: 'Failed to capture chart: ' + (e as Error).message }); }
  })();
  return true;
}
