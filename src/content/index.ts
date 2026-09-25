import { handleExtract } from './page-extractor';
import { handleStartAnnotation, handleClearAnnotation, injectAnnotationCSS, initAnnotationLang } from './annotation';
import { scrollBegin, scrollNext, scrollRestore } from './scroll-controller';
import { highlightParagraph } from './paragraphs';
import { highlightSelection, restoreHighlights } from './highlights';

// Localized annotation icon/bubble labels — read once at script load so the
// language is ready long before the user can trigger an annotation run.
initAnnotationLang();

chrome.runtime.onMessage.addListener((request: { action?: string }, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  if (request.action === 'extract') return handleExtract(request, sendResponse);

  // F6: save the current selection as a highlight (panel button / context menu).
  if (request.action === 'highlightSelection') {
    void highlightSelection(String((request as { note?: string }).note ?? '')).then(
      (h) => sendResponse({ ok: h !== null, highlight: h }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  // F6: a highlight was deleted / edited in the panel — repaint.
  if (request.action === 'refreshHighlights') {
    void restoreHighlights().then((n) => sendResponse({ ok: true, painted: n }), () => sendResponse({ ok: false }));
    return true;
  }

  // F8: Alt+Q — the worker needs the page's current selection.
  if (request.action === 'getSelection') {
    sendResponse({ text: window.getSelection()?.toString().trim() ?? '' });
    return;
  }

  // Citation click in the panel: jump to and flash the cited paragraph.
  if (request.action === 'highlightParagraph') {
    sendResponse({ ok: highlightParagraph(String((request as { text?: string }).text ?? '')) });
    return;
  }

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

  // Full-page capture scroll control (see scroll-controller.ts). Async —
  // return true keeps the sendResponse channel open for the settled metrics.
  if (request.action === 'scrollBegin') {
    void scrollBegin().then(
      (m) => sendResponse(m),
      () => sendResponse(undefined),
    );
    return true;
  }
  if (request.action === 'scrollNext') {
    void scrollNext().then(
      (m) => sendResponse(m),
      () => sendResponse(undefined),
    );
    return true;
  }
  if (request.action === 'scrollRestore') {
    void scrollRestore().then(() => sendResponse({ ok: true }));
    return true;
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

// F6: repaint this page's saved highlights once it has settled.
if (isContextValid()) {
  setTimeout(() => { void restoreHighlights().catch(() => { /* no worker / no DB */ }); }, 800);
}
