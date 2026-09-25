/**
 * F7 — immersive (bilingual) translation: a translation appears under each
 * paragraph of the page; toggling again removes them. Paragraphs already in
 * the target language (the UI language) are skipped. Batches go to the
 * worker's `translate` port, which caches per paragraph.
 */

import { openTranslatePort } from '../platform/ports';
import { getUiLang } from './annotation-meta';

const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, figcaption, td';
const CONTAINERS = ['article', 'main', '[role="main"]'];
const CLASS = 'ai-reader-translation';
const STYLE_ID = 'ai-reader-translation-style';
const BATCH_PARAGRAPHS = 10;
const BATCH_CHARS = 3000;
const CONCURRENCY = 2;

let _active = false;
let _port: chrome.runtime.Port | null = null;
let _gen = 0;

export const isImmersiveActive = (): boolean => _active;

/** Share of CJK characters among letters — decides "already in the target language". */
export function cjkRatio(text: string): number {
  const cjk = text.match(/[㐀-鿿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return cjk + latin === 0 ? 0 : cjk / (cjk + latin);
}

export function needsTranslation(text: string, target: 'zh' | 'en'): boolean {
  if (text.replace(/\s+/g, '').length < 2) return false;
  const r = cjkRatio(text);
  return target === 'zh' ? r < 0.3 : r > 0.3;
}

/** Leaf-most text blocks of the article (or body) that need translating. */
export function collectTranslatable(root: Document = document, target: 'zh' | 'en' = getUiLang()): HTMLElement[] {
  let container: ParentNode | null = null;
  for (const sel of CONTAINERS) { container = root.querySelector(sel); if (container) break; }
  container ??= root.body;
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(BLOCKS)).filter((el) =>
    !el.querySelector(BLOCKS)
    && !el.closest(`nav, footer, aside, script, style, noscript, .${CLASS}`)
    && needsTranslation(el.innerText || el.textContent || '', target));
}

function batches(els: HTMLElement[]): HTMLElement[][] {
  const out: HTMLElement[][] = [];
  let cur: HTMLElement[] = [];
  let chars = 0;
  for (const el of els) {
    const len = (el.textContent || '').length;
    if (cur.length && (cur.length >= BATCH_PARAGRAPHS || chars + len > BATCH_CHARS)) { out.push(cur); cur = []; chars = 0; }
    cur.push(el);
    chars += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.${CLASS}{margin:4px 0 10px;padding-left:8px;border-left:3px solid rgba(66,133,244,.45);color:#555;font-size:.95em;line-height:1.6}`
    + `@media (prefers-color-scheme: dark){.${CLASS}{color:#bbb}}`;
  (document.head || document.documentElement).appendChild(style);
}

function insertTranslation(el: HTMLElement, text: string): void {
  if (!text) return;
  const div = document.createElement('div');
  div.className = CLASS;
  div.textContent = text;
  // Inside list items / cells (keeps list & table structure), after other blocks.
  if (el.tagName === 'LI' || el.tagName === 'TD') el.appendChild(div);
  else el.insertAdjacentElement('afterend', div);
}

export function clearImmersive(): void {
  _active = false;
  _gen++;
  try { _port?.disconnect(); } catch { /* gone */ }
  _port = null;
  document.querySelectorAll(`.${CLASS}`).forEach((n) => n.remove());
}

/** Turn immersive translation on (translating progressively) or off. Returns the new state. */
export async function toggleImmersive(): Promise<boolean> {
  if (_active) { clearImmersive(); return false; }
  _active = true;
  const gen = ++_gen;
  ensureStyle();
  const port = openTranslatePort();
  _port = port;
  const pending = new Map<number, (r: { translations?: string[]; error?: string }) => void>();
  port.onMessage.addListener((msg: { type?: string; id?: number; translations?: string[]; error?: string; errorKey?: string }) => {
    const done = msg.id != null ? pending.get(msg.id) : undefined;
    if (!done) return;
    pending.delete(msg.id!);
    done(msg.type === 'translated' ? { translations: msg.translations } : { error: msg.errorKey || msg.error || 'error' });
  });
  port.onDisconnect.addListener(() => { for (const done of pending.values()) done({ error: 'disconnected' }); pending.clear(); });

  const queue = batches(collectTranslatable());
  let nextId = 0;
  let firstError = '';
  const worker = async (): Promise<void> => {
    while (_active && _gen === gen && queue.length) {
      const batch = queue.shift()!;
      const id = nextId++;
      const res = await new Promise<{ translations?: string[]; error?: string }>((resolve) => {
        pending.set(id, resolve);
        try { port.postMessage({ type: 'translate', id, texts: batch.map((el) => (el.innerText || el.textContent || '').trim()) }); }
        catch { pending.delete(id); resolve({ error: 'disconnected' }); }
      });
      if (_gen !== gen) return;
      if (res.error) { firstError ||= res.error; continue; }
      batch.forEach((el, i) => insertTranslation(el, res.translations?.[i] ?? ''));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (_gen === gen) {
    try { port.disconnect(); } catch { /* gone */ }
    if (_port === port) _port = null;
    try { chrome.runtime.sendMessage({ action: 'immersiveDone', error: firstError || undefined }).catch(() => {}); } catch { /* invalidated */ }
  }
  return true;
}
