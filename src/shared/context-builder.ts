/**
 * Context budgeting for chat requests. Pure — usable from the panel and the
 * worker, and unit-tested without a DOM.
 *
 * Page: the article as numbered paragraphs ("[#N] …", the labels citations
 * refer to). Within budget, all of it. Over budget, instead of cutting the
 * tail off (the old behaviour lost everything after 64K characters):
 *   - the opening (what the article is about),
 *   - the paragraphs most relevant to the question, each with a neighbour
 *     on both sides,
 *   - or, when the question carries no usable terms ("summarize this"), an
 *     even sample across the whole article,
 * in document order, with "…" marking omitted stretches.
 *
 * History: the most recent turns that fit the budget; older turns are
 * dropped (whole messages, never a half message).
 */

import type { ChatMessage } from './types';

export const PAGE_BUDGET_CHARS = 60_000;
export const HISTORY_BUDGET_CHARS = 30_000;
/** Share of the page budget reserved for the article's opening when selecting. */
const HEAD_SHARE = 0.15;

export interface PageContext {
  /** Labelled paragraphs ready for the prompt. */
  text: string;
  /** True when paragraphs were left out. */
  partial: boolean;
  /** Indices of the paragraphs included. */
  included: number[];
}

/** Split plain text into paragraphs (blank lines, else single lines), merging tiny fragments. */
export function splitParagraphs(text: string, minChars = 40): string[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const raw = blocks.length > 1 ? blocks : text.split(/\n/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of raw) {
    const clean = p.replace(/\s+/g, ' ');
    if (out.length && out[out.length - 1].length < minChars) out[out.length - 1] += ' ' + clean;
    else out.push(clean);
  }
  return out;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that',
  'what', 'which', 'who', 'how', 'why', 'when', 'does', 'do', 'did', 'with', 'about', 'from', 'as', 'by', 'at', 'can',
  'please', 'me', 'you', 'i', 'article', 'page', 'text',
]);

/** Terms for matching: lowercase latin words / numbers, and CJK character bigrams. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []) {
    if (w.length > 1 && !STOPWORDS.has(w)) out.push(w);
  }
  for (const run of text.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** BM25-style relevance of each paragraph to the query. */
export function scoreParagraphs(paragraphs: string[], query: string): number[] {
  const q = [...new Set(terms(query))];
  if (!q.length) return paragraphs.map(() => 0);
  const docs = paragraphs.map((p) => terms(p));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length) || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.2;
  const b = 0.75;
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avgLen));
    }
    return score;
  });
}

const label = (i: number, p: string): string => `[#${i}] ${p}`;

/** Build the page context for one request. */
export function buildPageContext(paragraphs: string[], question: string, budget = PAGE_BUDGET_CHARS): PageContext {
  const cost = paragraphs.map((p, i) => label(i, p).length + 2);
  const total = cost.reduce((s, c) => s + c, 0);
  if (total <= budget) {
    return { text: paragraphs.map((p, i) => label(i, p)).join('\n\n'), partial: false, included: paragraphs.map((_, i) => i) };
  }

  const chosen = new Set<number>();
  let used = 0;
  const take = (i: number): boolean => {
    if (i < 0 || i >= paragraphs.length || chosen.has(i)) return false;
    if (used + cost[i] > budget) return false;
    chosen.add(i);
    used += cost[i];
    return true;
  };

  // 1. The opening.
  for (let i = 0; i < paragraphs.length && used < budget * HEAD_SHARE; i++) if (!take(i)) break;

  // 2. Relevant paragraphs with a neighbour each side — or an even sample.
  const scores = scoreParagraphs(paragraphs, question);
  const ranked = scores.map((s, i) => [s, i] as const).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
  if (ranked.length) {
    for (const [, i] of ranked) {
      take(i);
      take(i - 1);
      take(i + 1);
      if (used >= budget) break;
    }
  }
  if (!ranked.length || used < budget * 0.5) {
    const remaining = paragraphs.length - chosen.size;
    const stride = Math.max(1, Math.round(total / Math.max(1, budget - used)));
    for (let i = 0; i < paragraphs.length && remaining > 0; i += stride) take(i);
    for (let i = 0; i < paragraphs.length; i++) take(i); // fill what still fits, in order
  }

  const included = [...chosen].sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = -1;
  for (const i of included) {
    if (i !== prev + 1) parts.push('…');
    parts.push(label(i, paragraphs[i]));
    prev = i;
  }
  if (prev !== paragraphs.length - 1) parts.push('…');
  return { text: parts.join('\n\n'), partial: true, included };
}

const size = (m: ChatMessage): number =>
  typeof m.content === 'string' ? m.content.length : m.content.reduce((s, p) => s + (p.type === 'text' ? p.text.length : 1000), 0);

/**
 * The newest history messages that fit `budget`, oldest first. Whole
 * messages only; the result never starts with an assistant turn (a dangling
 * answer without its question confuses models and Anthropic rejects it).
 */
export function trimHistory(history: ChatMessage[], budget = HISTORY_BUDGET_CHARS): { messages: ChatMessage[]; dropped: number } {
  let used = 0;
  let start = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    const s = size(history[i]);
    if (used + s > budget && start < history.length) break;
    used += s;
    start = i;
  }
  while (start < history.length && history[start].role !== 'user') start++;
  return { messages: history.slice(start), dropped: start };
}
