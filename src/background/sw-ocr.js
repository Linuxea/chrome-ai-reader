export function handleOcrParse(msg, sendResponse) {
  chrome.storage.sync.get('ocrApiKey', (config) => {
    console.log('[OCR] Received ocrParse, has key:', !!config.ocrApiKey, 'file length:', msg.file?.length);
    if (!config.ocrApiKey) {
      sendResponse({ success: false, errorKey: 'error.noOcrApiKey' });
      return;
    }

    fetch('https://open.bigmodel.cn/api/paas/v4/layout_parsing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ocrApiKey}`
      },
      body: JSON.stringify({
        model: 'glm-ocr',
        file: msg.file
      })
    })
    .then(res => {
      console.log('[OCR] API response status:', res.status);
      if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `OCR request failed (${res.status})`); });
      return res.json();
    })
    .then(data => {
      console.log('[OCR] Success');
      sendResponse({ success: true, data });
    })
    .catch(e => {
      console.error('[OCR] Error:', e.message);
      sendResponse({ success: false, error: e.message });
    });
  });

  return true;
}
