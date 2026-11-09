/**
 * F14 — share card: pure-DOM builder for the "AI answer → share image" card.
 *
 * The card is a self-contained subtree: every style it needs lives in an
 * inline <style> inside the card root, because services/share-image
 * serializes the node standalone into an SVG foreignObject — it cannot
 * inherit side-panel CSS there, and any url() reference would either break
 * or taint the canvas. The palette is fixed-light regardless of the active
 * theme (R-03 / AC-04); only the accent (theme --primary) is injected per
 * build. System fonts only, no external resources.
 *
 * Pure DOM + string logic throughout: everything runs in jsdom, no canvas.
 */

import { t } from '../../shared/i18n.js';
import { renderMarkdown } from './markdown';

/** D-01: card width in CSS px; rasterized at 2x → 1440px PNG. */
export const SHARE_CARD_WIDTH = 720;
/** E-01 second chance: rebuild at this width when 720px overflows the canvas. */
export const SHARE_CARD_NARROW_WIDTH = 560;
/** E-01: canvas per-side safe ceiling — scale down or cut beyond this. */
export const MAX_CARD_HEIGHT = 16000;
/** E-01 soft cap: cut the answer at a paragraph boundary near this length. */
export const SOFT_CHAR_LIMIT = 12000;
/** E-01 last resort after the narrow rebuild still overflows. */
export const HARD_CHAR_LIMIT = 6000;

export interface ShareCardData {
  /** Preceding user question; empty/omitted → no question block (E-05). */
  question?: string;
  /** Source page title; empty/omitted → no source line (E-04). */
  pageTitle?: string;
  /** Preformatted date string shown in the header. */
  date: string;
  /** Theme --primary hex value injected into the inline card styles. */
  accent: string;
  /** Answer markdown — rendered through renderMarkdown (sanitized there). */
  markdown: string;
  /** Force the truncation footnote (set by the fitShareCard stages). */
  truncated?: boolean;
}

/**
 * E-01 primary truncation: accumulate whole paragraphs until the soft limit;
 * never stops mid-paragraph, so no fence/table/list is left half-open. A
 * single paragraph longer than the limit is character-cut as the only
 * fallback.
 */
export function truncateMarkdown(md: string, limit: number): { text: string; truncated: boolean } {
  if (md.length <= limit) return { text: md, truncated: false };
  const paragraphs = md.split(/\n{2,}/);
  let out = '';
  for (const p of paragraphs) {
    const next = out ? `${out}\n\n${p}` : p;
    if (next.length > limit) break;
    out = next;
  }
  if (!out) out = md.slice(0, limit);
  return { text: out, truncated: true };
}

function cardStyle(accent: string, width: number): string {
  return `
.share-card { box-sizing: border-box; width: ${width}px; padding: 0 32px 24px; background: #ffffff; color: #1f2328; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
.share-card * { box-sizing: border-box; margin: 0; padding: 0; }
.share-card-top { height: 4px; margin: 0 -32px 20px; background: ${accent}; }
.share-card-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.share-card-brand { font-size: 18px; font-weight: 700; }
.share-card-date { font-size: 13px; color: #57606a; }
.share-card-source { margin-bottom: 14px; padding-left: 10px; border-left: 3px solid ${accent}; font-size: 14px; color: #57606a; }
.share-card-question { margin-bottom: 18px; padding: 12px 14px; background: #f5f6f8; border-left: 3px solid ${accent}; border-radius: 8px; font-size: 15px; font-weight: 600; }
.share-card-q { margin-right: 6px; color: ${accent}; }
.share-card-body { font-size: 14px; line-height: 1.75; word-break: break-word; overflow-wrap: anywhere; }
.share-card-body p { margin-bottom: 10px; }
.share-card-body h1 { margin: 18px 0 10px; font-size: 20px; line-height: 1.4; }
.share-card-body h2 { margin: 18px 0 10px; font-size: 18px; line-height: 1.4; }
.share-card-body h3 { margin: 16px 0 10px; font-size: 16px; line-height: 1.4; }
.share-card-body h4 { margin: 16px 0 10px; font-size: 15px; line-height: 1.4; }
.share-card-body ul, .share-card-body ol { margin-bottom: 10px; padding-left: 22px; }
.share-card-body li { margin-bottom: 4px; }
.share-card-body a { color: ${accent}; text-decoration: none; }
.share-card-body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: #f5f6f8; border-radius: 4px; padding: 1px 5px; }
.share-card-body pre { margin-bottom: 10px; padding: 12px 14px; background: #f5f6f8; border-radius: 8px; overflow: hidden; white-space: pre-wrap; word-break: break-word; }
.share-card-body pre code { background: none; padding: 0; }
.share-card-body blockquote { margin-bottom: 10px; padding: 2px 0 2px 12px; border-left: 3px solid ${accent}; color: #57606a; }
.share-card-body table { width: 100%; margin-bottom: 10px; border-collapse: collapse; font-size: 13px; }
.share-card-body th, .share-card-body td { border: 1px solid #d8dde3; padding: 6px 10px; text-align: left; }
.share-card-body th { background: #f5f6f8; }
.share-card-body img { max-width: 100%; }
.share-card-truncated { margin-top: 6px; font-size: 12px; font-style: italic; color: #8b949e; }
.share-card-footer { margin-top: 22px; padding-top: 14px; border-top: 1px solid #e8eaed; text-align: center; font-size: 12px; color: #8b949e; }
`;
}

/**
 * Build the card DOM (not attached to the document — the caller mounts it
 * off-screen to measure, then serializes it). The xmlns attribute keeps the
 * XMLSerializer output valid XHTML for the foreignObject rasterization.
 */
export function buildShareCard(data: ShareCardData, width: number = SHARE_CARD_WIDTH): HTMLElement {
  const { question, pageTitle, date, accent, markdown, truncated } = data;

  const el = document.createElement('div');
  el.className = 'share-card';
  el.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  el.style.width = `${width}px`;

  const style = document.createElement('style');
  style.textContent = cardStyle(accent, width);
  el.appendChild(style);

  const top = document.createElement('div');
  top.className = 'share-card-top';
  el.appendChild(top);

  const header = document.createElement('div');
  header.className = 'share-card-header';
  const brand = document.createElement('span');
  brand.className = 'share-card-brand';
  brand.textContent = t('app.fullName');
  const dateEl = document.createElement('span');
  dateEl.className = 'share-card-date';
  dateEl.textContent = date;
  header.append(brand, dateEl);
  el.appendChild(header);

  // E-04: no page title → no source line at all.
  if (pageTitle && pageTitle.trim()) {
    const source = document.createElement('div');
    source.className = 'share-card-source';
    source.textContent = t('share.source', { title: pageTitle });
    el.appendChild(source);
  }

  // E-05: no preceding user bubble → no question block.
  if (question && question.trim()) {
    const q = document.createElement('div');
    q.className = 'share-card-question';
    const qLabel = document.createElement('span');
    qLabel.className = 'share-card-q';
    qLabel.textContent = 'Q';
    const qText = document.createElement('span');
    qText.textContent = question;
    q.append(qLabel, qText);
    el.appendChild(q);
  }

  // Answer body: the one Markdown → DOM path (sanitized there). Citations
  // stay plain [#N] text — linkifyCitations is deliberately not run.
  const body = document.createElement('div');
  body.className = 'share-card-body';
  body.innerHTML = renderMarkdown(markdown);
  el.appendChild(body);

  if (truncated) {
    const note = document.createElement('div');
    note.className = 'share-card-truncated';
    note.textContent = t('share.truncated');
    el.appendChild(note);
  }

  const footer = document.createElement('div');
  footer.className = 'share-card-footer';
  footer.textContent = t('share.watermark', { app: t('app.fullName') });
  el.appendChild(footer);

  return el;
}

export interface FittedShareCard {
  el: HTMLElement;
  width: number;
  /** Last measured content height in CSS px (0 under jsdom). */
  height: number;
  truncated: boolean;
}

/**
 * E-01 cascade: (1) soft paragraph cut at 720px; (2) measured height over
 * the canvas ceiling → rebuild at 560px; (3) still over → hard char cut at
 * 560px. `measure` is injected so tests can fake heights without layout —
 * the real one mounts off-screen, reads, and removes (services layer).
 */
export function fitShareCard(data: ShareCardData, measure: (el: HTMLElement) => number): FittedShareCard {
  const soft = truncateMarkdown(data.markdown, SOFT_CHAR_LIMIT);
  const base: ShareCardData = { ...data, markdown: soft.text, truncated: soft.truncated };

  let width = SHARE_CARD_WIDTH;
  let el = buildShareCard(base, width);
  let height = measure(el);
  if (height > MAX_CARD_HEIGHT) {
    width = SHARE_CARD_NARROW_WIDTH;
    el = buildShareCard(base, width);
    height = measure(el);
    if (height > MAX_CARD_HEIGHT) {
      const hard = truncateMarkdown(data.markdown, HARD_CHAR_LIMIT);
      el = buildShareCard({ ...data, markdown: hard.text, truncated: true }, width);
      height = measure(el);
    }
  }
  // The footnote node is the single source of truth for "was truncated".
  const truncated = el.querySelector('.share-card-truncated') !== null;
  return { el, width, height, truncated };
}
