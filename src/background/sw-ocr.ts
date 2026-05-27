export function handleOcrParse(msg: { file?: string }, sendResponse: (r: { success: boolean; data?: unknown; error?: string; errorKey?: string }) => void): true {
  chrome.storage.sync.get('ocrApiKey', (config: { ocrApiKey?: string }) => {
    if (!config.ocrApiKey) { sendResponse({ success: false, errorKey: 'error.noOcrApiKey' }); return; }
    fetch('https://open.bigmodel.cn/api/paas/v4/layout_parsing', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.ocrApiKey}` },
      body: JSON.stringify({ model: 'glm-ocr', file: msg.file }),
    }).then(res => { if (!res.ok) return res.json().then((d: Record<string, { message?: string }>) => { throw new Error(d.error?.message || `OCR request failed (${res.status})`); }); return res.json(); })
      .then(data => { sendResponse({ success: true, data }); })
      .catch((e: Error) => { sendResponse({ success: false, error: e.message }); });
  });
  return true;
}
