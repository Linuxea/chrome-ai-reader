import { handleExtract } from './page-extractor';
import { handleDetectCharts, handleCaptureChart } from './chart-detector';
import { handleStartAnnotation, handleClearAnnotation, injectAnnotationCSS } from './annotation';

chrome.runtime.onMessage.addListener((request: { action?: string }, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  const handlers: Record<string, (msg: unknown, sendResponse: (r?: unknown) => void) => true | void> = {
    extract: handleExtract,
    detectCharts: handleDetectCharts,
    captureChart: handleCaptureChart as (msg: unknown, sendResponse: (r?: unknown) => void) => true,
  };
  const handler = handlers[request.action || ''];
  if (handler) return handler(request, sendResponse);

  // Annotation actions are fire-and-forget (no response payload needed).
  if (request.action === 'startAnnotation') {
    injectAnnotationCSS();
    handleStartAnnotation();
    sendResponse({ ok: true });
    return;
  }
  if (request.action === 'clearAnnotation') {
    handleClearAnnotation();
    sendResponse({ ok: true });
    return;
  }
});

function isContextValid(): boolean { return !!chrome.runtime?.id; }

let selectionTimer: ReturnType<typeof setTimeout> | undefined;

document.addEventListener('selectionchange', () => {
  if (!isContextValid()) return;
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    if (!isContextValid()) return;
    const text = window.getSelection()?.toString().trim() || '';
    try { chrome.runtime.sendMessage({ action: 'selectionChanged', text }).catch(() => {}); } catch { /* context invalidated */ }
  }, 300);
});
