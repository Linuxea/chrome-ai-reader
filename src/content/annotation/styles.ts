/**
 * Page-injected CSS (highlight + icon styles) for the annotation feature.
 * Kept as a string so the IIFE bundle includes them without a separate fetch.
 * Mirrors src/content/annotation.css.
 *
 * Extracted from the former god module content/annotation.ts.
 */

/** Page-injected highlight/icon styles. */
export const ANNOTATION_CSS = `
.anno-mark { background: #fff3bf; border-radius: 2px; padding: 0 1px; box-shadow: inset 0 -2px 0 rgba(255,193,7,0.5); }
.anno-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin: 0 2px; border: 1px solid rgba(0,0,0,0.12); border-radius: 50%; background: #fff; cursor: pointer; font-size: 12px; line-height: 1; vertical-align: middle; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.anno-icon:hover { transform: scale(1.12); }
.anno-icon-critique { background: #fff7e6; }
.anno-icon-counterpoint { background: #e8f7ef; }
.anno-icon-flaw { background: #fff1f0; }
`;

let _cssInjected = false;

/** Inject the highlight/icon stylesheet into the page head once. */
export function injectAnnotationCSS(): void {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'anno-styles';
  style.textContent = ANNOTATION_CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

/** Reset the injection flag (tests). */
export function _resetCssInjected(): void {
  _cssInjected = false;
}
