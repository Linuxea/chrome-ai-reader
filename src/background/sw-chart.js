export function handleChartVision(msg, sendResponse) {
  const { apiKey, messages } = msg;
  if (!apiKey) {
    sendResponse({ success: false, error: 'No API Key' });
    return;
  }

  fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'glm-4v-flash',
      messages,
      temperature: 0.3
    })
  })
  .then(res => {
    if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `API request failed (${res.status})`); });
    return res.json();
  })
  .then(data => {
    const content = data.choices?.[0]?.message?.content || '';
    sendResponse({ success: true, content });
  })
  .catch(e => {
    sendResponse({ success: false, error: e.message });
  });

  return true;
}

export function handleChartAnalysis(msg, sendResponse) {
  const { apiKey, apiBase, modelName } = msg;
  if (!apiKey) {
    sendResponse({ success: false, error: 'No API Key' });
    return;
  }
  const baseUrl = apiBase || 'https://api.deepseek.com';

  fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName || 'deepseek-chat',
      messages: msg.messages,
      response_format: { type: 'json_object' },
      temperature: 0.3
    })
  })
  .then(res => {
    if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `API request failed (${res.status})`); });
    return res.json();
  })
  .then(data => {
    const content = data.choices?.[0]?.message?.content || '';
    sendResponse({ success: true, content });
  })
  .catch(e => {
    sendResponse({ success: false, error: e.message });
  });

  return true;
}

export function handleChartScreenshot(msg, sendResponse) {
  const { scrollX, scrollY, pageX, pageY, pageW, pageH, devicePixelRatio } = msg;
  const dpr = devicePixelRatio || 1;
  console.log('[AI Reader SW] captureChartScreenshot received:', { scrollX, scrollY, pageX, pageY, pageW, pageH, dpr });
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, async (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error('[AI Reader SW] captureVisibleTab failed:', chrome.runtime.lastError?.message);
      sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'capture failed' });
      return;
    }
    console.log('[AI Reader SW] captureVisibleTab ok, dataUrl length:', dataUrl.length);
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      const sx = Math.max(0, (pageX - scrollX) * dpr);
      const sy = Math.max(0, (pageY - scrollY) * dpr);
      const maxSw = Math.max(0, bmp.width - sx);
      const maxSh = Math.max(0, bmp.height - sy);
      const sw = Math.min(pageW * dpr, maxSw);
      const sh = Math.min(pageH * dpr, maxSh);
      if (sw === 0 || sh === 0) throw new Error('Crop area is outside the screenshot');
      console.log('[AI Reader SW] crop params:', { sx, sy, sw, sh, bmpW: bmp.width, bmpH: bmp.height });
      const c = new OffscreenCanvas(Math.round(sw), Math.round(sh));
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, Math.round(sw), Math.round(sh));
      const outBlob = await c.convertToBlob({ type: 'image/png' });
      const buffer = await outBlob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Build base64 using chunk array to avoid O(n²) string concatenation
      const chunks = [];
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
      }
      const base64 = chunks.join('');
      console.log('[AI Reader SW] screenshot crop ok, base64 length:', base64.length);
      sendResponse({ success: true, dataUri: `data:image/png;base64,${base64}` });
    } catch (e) {
      console.error('[AI Reader SW] screenshot crop failed:', e.message);
      sendResponse({ success: false, error: 'screenshot crop failed: ' + e.message });
    }
  });
  return true;
}
