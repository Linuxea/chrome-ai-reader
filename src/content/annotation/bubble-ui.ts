/**
 * Bubble UI — Shadow-DOM isolated annotation bubbles + click-to-open icons.
 * Owns the singleton bubble host, icon creation, and bubble positioning.
 *
 * Extracted from the former god module content/annotation.ts so the rendering
 * layer is independent of the orchestration (concurrency pool + ports).
 */

import type { Annotation } from '../../shared/types';
import { ICON_BY_PERSPECTIVE, getPerspectiveLabel, getBubbleTexts } from '../annotation-meta';

// --- Bubble rendering (Shadow-DOM isolated) ---

/** Singleton container appended to document.body; holds bubbles + isolated CSS. */
let _bubbleHost: HTMLElement | null = null;

const BUBBLE_CSS = `
  .anno-bubble {
    position: absolute;
    width: 320px;
    background: #fff;
    color: #1f2329;
    border: 1px solid #e5e6eb;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.14);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
    pointer-events: auto;
    box-sizing: border-box;
  }
  .anno-bubble-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #f0f1f3; font-weight: 600; }
  .anno-bubble-label { flex: 1; }
  .anno-bubble-close { background: none; border: none; cursor: pointer; font-size: 14px; color: #86909c; padding: 0 2px; }
  .anno-comment { padding: 10px 12px; color: #1f2329; word-break: break-word; }
  .anno-followup { display: block; width: 100%; text-align: left; border: none; border-top: 1px solid #f0f1f3; background: #f7f8fa; color: #165dff; cursor: pointer; padding: 8px 12px; font: inherit; box-sizing: border-box; }
  .anno-followup:hover { background: #eef2ff; }
  .anno-bubble.critique .anno-bubble-header { background: #fff7e6; }
  .anno-bubble.counterpoint .anno-bubble-header { background: #e8f7ef; }
  .anno-bubble.flaw .anno-bubble-header { background: #fff1f0; }
`;

/**
 * Return (and lazily create) the bubble host element whose Shadow DOM holds the
 * open bubble. Pass `reset=true` to drop the singleton (tests).
 */
export function getBubbleHost(reset = false): HTMLElement {
  if (reset) {
    _bubbleHost?.remove();
    _bubbleHost = null;
  }
  if (_bubbleHost) return _bubbleHost;

  const host = document.createElement('div');
  host.id = 'anno-bubble-host';
  // Zero-size absolute container anchored at the document origin. Bubbles use
  // position:absolute with DOCUMENT coordinates (getBoundingClientRect +
  // scroll offset), so they scroll naturally with the page — no scroll
  // listener needed. pointer-events:none on the host lets clicks pass through;
  // each .anno-bubble re-enables pointer-events:auto (see BUBBLE_CSS).
  host.style.position = 'absolute';
  host.style.zIndex = '2147483647';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.pointerEvents = 'none';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${BUBBLE_CSS}</style><div class="anno-bubble-layer" part="layer"></div>`;
  document.body.appendChild(host);
  _bubbleHost = host;
  return host;
}

/** Handle returned when attaching an icon to a node. */
export interface IconHandle {
  button: HTMLButtonElement;
}

/**
 * Attach an annotation icon immediately after `anchor` (typically the
 * <mark> wrapping the quoted sentence), so the icon sits right next to the
 * highlighted phrase rather than at the end of the paragraph. On click, opens
 * a Shadow-DOM bubble showing the comment; only one bubble open at a time.
 * `onFollowUp` (optional) is invoked with the full annotation (quote +
 * comment) when the user clicks "follow up in chat".
 */
export function createIconFor(
  anchor: HTMLElement,
  annotation: Annotation,
  onFollowUp?: (annotation: Annotation) => void,
): IconHandle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `anno-icon anno-icon-${annotation.perspective}`;
  button.setAttribute('aria-label', getPerspectiveLabel(annotation.perspective));
  button.textContent = ICON_BY_PERSPECTIVE[annotation.perspective];
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    openBubble(button, annotation, onFollowUp);
  });
  // Place the icon immediately after the anchor (the <mark>).
  anchor.insertAdjacentElement('afterend', button);
  return { button };
}

/** The icon anchor currently owning an open bubble (for outside-click guards). */
let _activeAnchor: HTMLElement | null = null;

function openBubble(anchor: HTMLElement, annotation: Annotation, onFollowUp?: (annotation: Annotation) => void): void {
  const host = getBubbleHost();
  const layer = host.shadowRoot!.querySelector('.anno-bubble-layer')!;
  // Close any existing bubble (only one at a time).
  layer.innerHTML = '';

  const bubble = document.createElement('div');
  bubble.className = `anno-bubble ${annotation.perspective}`;
  const texts = getBubbleTexts();
  bubble.innerHTML = `
    <div class="anno-bubble-header">
      <span>${ICON_BY_PERSPECTIVE[annotation.perspective]}</span>
      <span class="anno-bubble-label">${getPerspectiveLabel(annotation.perspective)}</span>
      <button class="anno-bubble-close" type="button" aria-label="${texts.close}">✕</button>
    </div>
    <div class="anno-comment"></div>
    <button class="anno-followup" type="button">${texts.followUp}</button>
  `;
  // Set comment text safely (avoid HTML injection).
  (bubble.querySelector('.anno-comment') as HTMLElement).textContent = annotation.comment;

  // Position below the anchor using DOCUMENT coordinates. Because the host is
  // position:absolute at the document origin, absolute left/top here are
  // document-relative — so the bubble scrolls naturally with the page.
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left + window.scrollX, document.documentElement.scrollWidth - 320 - 8));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${rect.bottom + window.scrollY + 6}px`;
  layer.appendChild(bubble);

  _activeAnchor = anchor;

  const close = () => {
    layer.innerHTML = '';
    _activeAnchor = null;
    document.removeEventListener('click', onDocClick);
  };
  const onDocClick = (ev: MouseEvent) => {
    const target = ev.target as Node;
    // Ignore clicks on the anchor itself (it has its own stopPropagation handler
    // anyway) and anything inside the bubble.
    if (_activeAnchor && _activeAnchor.contains(target)) return;
    if (bubble.contains(target)) return;
    close();
  };
  (bubble.querySelector('.anno-bubble-close') as HTMLElement).addEventListener('click', (ev) => {
    ev.stopPropagation();
    close();
  });
  (bubble.querySelector('.anno-followup') as HTMLElement).addEventListener('click', (ev) => {
    ev.stopPropagation();
    onFollowUp?.(annotation);
    close();
  });
  // Attach synchronously so a subsequent outside click (e.g. document.body.click()
  // right after) closes the bubble. The anchor's own click handler calls
  // stopPropagation, so opening the bubble won't immediately trigger onDocClick.
  document.addEventListener('click', onDocClick);
}
