export function handleChartVision(msg: { apiKey?: string; messages: unknown[] }, sendResponse: (r: { success: boolean; content?: string; error?: string }) => void): true {
  const { apiKey, messages } = msg;
  if (!apiKey) { sendResponse({ success: false, error: 'No API Key' }); return true; }
  fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'glm-4v-flash', messages, temperature: 0.3 }),
  }).then(res => { if (!res.ok) return res.json().then((d: Record<string, { message?: string }>) => { throw new Error(d.error?.message || `API request failed (${res.status})`); }); return res.json(); })
    .then((data: Record<string, unknown>) => { const content = (data.choices as Record<string, unknown>[])?.[0]?.message && typeof (data.choices as Record<string, unknown>[])[0].message === 'object' ? ((data.choices as Record<string, { content?: string }>[])[0].message?.content || '') : ''; sendResponse({ success: true, content }); })
    .catch((e: Error) => { sendResponse({ success: false, error: e.message }); });
  return true;
}

export function handleChartAnalysis(msg: { apiKey?: string; apiBase?: string; modelName?: string; messages: unknown[] }, sendResponse: (r: { success: boolean; content?: string; error?: string }) => void): true {
  const { apiKey, apiBase, modelName } = msg;
  if (!apiKey) { sendResponse({ success: false, error: 'No API Key' }); return true; }
  const baseUrl = apiBase || 'https://api.deepseek.com';
  fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelName || 'deepseek-chat', messages: msg.messages, response_format: { type: 'json_object' }, temperature: 0.3 }),
  }).then(res => { if (!res.ok) return res.json().then((d: Record<string, { message?: string }>) => { throw new Error(d.error?.message || `API request failed (${res.status})`); }); return res.json(); })
    .then((data: Record<string, unknown>) => { const content = (data.choices as Record<string, { content?: string }>[])?.[0]?.message?.content || ''; sendResponse({ success: true, content }); })
    .catch((e: Error) => { sendResponse({ success: false, error: e.message }); });
  return true;
}

export function handleChartScreenshot(msg: { scrollX: number; scrollY: number; pageX: number; pageY: number; pageW: number; pageH: number; devicePixelRatio?: number }, sendResponse: (r: { success: boolean; dataUri?: string; error?: string }) => void): true {
  const { scrollX, scrollY, pageX, pageY, pageW, pageH, devicePixelRatio } = msg;
  const dpr = devicePixelRatio || 1;
  chrome.tabs.captureVisibleTab(null as unknown as number, { format: 'png' }, async (dataUrl?: string) => {
    if (chrome.runtime.lastError || !dataUrl) { sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'capture failed' }); return; }
    try {
      const resp = await fetch(dataUrl); const blob = await resp.blob(); const bmp = await createImageBitmap(blob);
      const sx = Math.max(0, (pageX - scrollX) * dpr); const sy = Math.max(0, (pageY - scrollY) * dpr);
      const sw = Math.min(pageW * dpr, Math.max(0, bmp.width - sx)); const sh = Math.min(pageH * dpr, Math.max(0, bmp.height - sy));
      if (sw === 0 || sh === 0) throw new Error('Crop area is outside the screenshot');
      const c = new OffscreenCanvas(Math.round(sw), Math.round(sh)); c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, Math.round(sw), Math.round(sh));
      const outBlob = await c.convertToBlob({ type: 'image/png' }); const buffer = await outBlob.arrayBuffer(); const bytes = new Uint8Array(buffer);
      const chunks: string[] = []; const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
      sendResponse({ success: true, dataUri: `data:image/png;base64,${chunks.join('')}` });
    } catch (e: unknown) { sendResponse({ success: false, error: 'screenshot crop failed: ' + (e as Error).message }); }
  });
  return true;
}
