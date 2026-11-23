/**
 * F15 web search — the pure half of the DeepSeek `deepseek_web_search`
 * integration (no DOM, no chrome.*): wire parsing, result shaping and the
 * citation-marker insertion the panel renders. Usable from the worker
 * (provider + runner) and the side panel alike.
 *
 * Wire facts, verified against the live API on 2026-11-23 (recorded in
 * docs/design/设计方案_F15_联网搜索.md §10):
 * - progress arrives as `choices[0].server_tool_event`, in chunks that carry
 *   no `delta`; within a step, `call_completed` events arrive out of order;
 * - the complete `server_tool_calls` + `annotations` ride ONCE, on the delta
 *   of the chunk that carries `finish_reason`;
 * - the answer text has no citation markers — `annotations` are Unicode
 *   code-point ranges into `content`.
 *
 * Every parser is lenient: the wire shape is documented but young, so a
 * malformed event is dropped, never thrown.
 */

import type { WebCitation, WebResult, WebSource, WebStep, WebStepAction } from './types';
import type { ServerToolEvent } from './protocol';

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && v >= 0;
const nonNull = <T>(v: T | null): v is T => v !== null;

const KINDS: readonly WebStep['kind'][] = ['search', 'deep_search', 'image_search', 'deep_image_search'];

function parseKind(v: unknown): WebStep['kind'] {
  return KINDS.includes(v as WebStep['kind']) ? (v as WebStep['kind']) : 'search';
}

function parseAction(v: unknown): WebStepAction | null {
  if (!isRecord(v)) return null;
  switch (v.type) {
    case 'search': {
      const queries = Array.isArray(v.queries) ? v.queries.filter((q): q is string => typeof q === 'string') : [];
      return { type: 'search', queries };
    }
    case 'open_page':
      return typeof v.url === 'string' ? { type: 'open_page', url: v.url } : null;
    case 'find_in_page':
      return typeof v.url === 'string' && typeof v.pattern === 'string'
        ? { type: 'find_in_page', url: v.url, pattern: v.pattern }
        : null;
    default:
      return null;
  }
}

function parseSource(v: unknown): WebSource | null {
  if (!isRecord(v) || typeof v.url !== 'string' || !v.url) return null;
  const siteName = typeof v.site_name === 'string' && v.site_name ? v.site_name : undefined;
  return {
    url: v.url,
    title: (typeof v.title === 'string' && v.title) || v.url,
    ...(siteName ? { siteName } : {}),
  };
}

function parsePage(v: unknown): WebStep['page'] | undefined {
  if (!isRecord(v) || typeof v.url !== 'string') return undefined;
  return { url: v.url, title: typeof v.title === 'string' ? v.title : null };
}

function parseError(v: unknown): string | undefined {
  return isRecord(v) && typeof v.code === 'string' && v.code ? v.code : undefined;
}

/** Normalize one `choices[0].server_tool_event`; null when it is not one. */
export function parseServerToolEvent(raw: unknown): ServerToolEvent | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  const step = isInt(raw.step) ? raw.step : 0;
  if (raw.type === 'step_reasoning_done') return { type: 'step_reasoning_done', step };
  if (raw.type !== 'call_started' && raw.type !== 'call_completed') return null;
  const call = raw.call;
  if (!isRecord(call) || typeof call.id !== 'string' || !call.id) return null;
  const index = isInt(call.index) ? call.index : 0;
  if (raw.type === 'call_started') {
    const action = parseAction(call.action);
    if (!action) return null;
    return { type: 'call_started', step, call: { id: call.id, index, kind: parseKind(call.kind), action } };
  }
  const sources = Array.isArray(call.sources) ? call.sources.map(parseSource).filter(nonNull) : undefined;
  const page = parsePage(call.page);
  const error = parseError(call.error);
  return {
    type: 'call_completed',
    step,
    call: {
      id: call.id,
      index,
      status: call.status === 'failed' ? 'failed' : 'completed',
      ...(sources?.length ? { sources } : {}),
      ...(page ? { page } : {}),
      ...(error ? { error } : {}),
    },
  };
}

/** Flatten the last chunk's `delta.server_tool_calls` (steps → calls) into display steps. */
function parseSteps(raw: unknown): WebStep[] {
  const out: WebStep[] = [];
  if (!Array.isArray(raw)) return out;
  for (const step of raw) {
    if (!isRecord(step) || !Array.isArray(step.calls)) continue;
    for (const call of step.calls) {
      if (!isRecord(call) || typeof call.id !== 'string' || !call.id) continue;
      const action = parseAction(call.action);
      if (!action) continue;
      const webStep: WebStep = { id: call.id, kind: parseKind(call.kind), action, status: call.status === 'failed' ? 'failed' : 'completed' };
      const sources = Array.isArray(call.sources) ? call.sources.map(parseSource).filter(nonNull) : [];
      if (sources.length) webStep.sources = sources;
      const page = parsePage(call.page);
      if (page) webStep.page = page;
      const error = parseError(call.error);
      if (error) webStep.error = error;
      out.push(webStep);
    }
  }
  return out;
}

/** Counts + empty citation lists for a set of steps; undefined when nothing was done. */
export function webResultFromSteps(steps: WebStep[]): WebResult | undefined {
  if (!steps.length) return undefined;
  const searches = steps.filter((s) => s.action.type === 'search').length;
  const pages = new Set(steps.flatMap((s) => (s.action.type === 'search' ? [] : [s.action.url]))).size;
  return { steps, sources: [], citations: [], searches, pages };
}

/**
 * Shape the last chunk's `delta.server_tool_calls` + `delta.annotations` into
 * a WebResult. Undefined when neither carries anything (the model did not use
 * the web), so callers can leave `web` off the message entirely.
 */
export function buildWebResult(serverToolCalls: unknown, annotations: unknown): WebResult | undefined {
  const steps = parseSteps(serverToolCalls);
  const result = webResultFromSteps(steps) ?? { steps: [], sources: [], citations: [], searches: 0, pages: 0 };
  if (Array.isArray(annotations)) {
    for (const item of annotations) {
      const c = isRecord(item) && isRecord(item.url_citation) ? item.url_citation : null;
      if (!c || typeof c.url !== 'string' || !c.url || !isInt(c.start_index) || !isInt(c.end_index)) continue;
      const source = citedSource(result, c.url, citationTitle(c, steps));
      result.citations.push({ start: c.start_index, end: c.end_index, source });
    }
  }
  return result.steps.length || result.citations.length ? result : undefined;
}

/** The title to show for a citation: the search result / opened page it points at, else the annotation's own. */
function citationTitle(c: Raw, steps: WebStep[]): { title: string; siteName?: string } {
  for (const step of steps) {
    const hit = step.sources?.find((s) => s.url === c.url);
    if (hit) return hit;
    const page = step.page;
    if (page && page.url === c.url) return { title: page.title || '' };
  }
  const own = typeof c.title === 'string' ? c.title : '';
  // The API puts the URL in `title` when the real one is unknown.
  return { title: own && !/^[a-z][a-z0-9+.-]*:/i.test(own) ? own : '' };
}

function citedSource(result: WebResult, url: string, info: { title: string; siteName?: string }): number {
  const existing = result.sources.findIndex((s) => s.url === url);
  if (existing !== -1) return existing;
  result.sources.push({ url, title: info.title || url, ...(info.siteName ? { siteName: info.siteName } : {}) });
  return result.sources.length - 1;
}

// --- citation markers -------------------------------------------------------

const HTTP_URL = /^https?:\/\/\S+$/i;

/**
 * `url` if it is an absolute http(s) URL, else null. Source URLs come from
 * the API response (untrusted, like everything the model returns): they may
 * become an `href` only after this check — a `javascript:` link in a citation
 * would run in the extension page when clicked.
 */
export function safeHttpUrl(url: string | undefined | null): string | null {
  return url && HTTP_URL.test(url) ? url : null;
}

/** `\uE000<n>\uE001` marks where source n (1-based) is cited. */
export const CITATION_MARKER_RE = /\uE000(\d{1,3})\uE001/g;
const MARK_START = '\uE000';
const MARK_END = '\uE001';

const DELIMITERS = new Set(['*', '_', '`', '~']);
/** A link destination longer than this is not one — do not chase its `)`. */
const LINK_DEST_MAX = 2000;
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '.']);
const CLOSERS = new Set(['”', '’', '」', '『', '）', ')', '"', "'", '】', '〕', '》']);
/** How many closing marks a marker may step over. */
const CLOSERS_MAX = 4;

/**
 * The run `cps[at..end)` closes a sentence: it holds at least one
 * sentence-ender, and an ASCII one (`.`, `!`, `?`) is followed by whitespace
 * or the end of the text — otherwise it is a decimal point or an
 * abbreviation ("3.14", "e.g."), and the marker stays put.
 */
function closesSentence(cps: string[], at: number, end: number): boolean {
  const run = cps.slice(at, end);
  if (!run.some((ch) => SENTENCE_END.has(ch))) return false;
  if (!run.some((ch) => ch === '.' || ch === '!' || ch === '?')) return true;
  const after = cps[end];
  return after === undefined || /\s/.test(after);
}

/**
 * E-07: move an insertion point out of the places where a marker would read
 * wrong or break the Markdown:
 * - the middle of a delimiter run (`**` → `*⟨n⟩*` breaks bold);
 * - a link destination (`](url⟨n⟩)`);
 * - between a cited sentence and its closing punctuation. The API ends a
 *   cited span BEFORE the `。` / `.` (all 7 citations of the stream captured
 *   on 2026-11-23 do), and the chip reads better after it: `…API”。[1]`.
 */
function nudge(cps: string[], at: number): number {
  const prev = cps[at - 1];
  const next = cps[at];
  if (prev !== undefined && prev === next && DELIMITERS.has(prev)) {
    let i = at;
    while (i < cps.length && cps[i] === prev) i++;
    return i;
  }
  for (let j = at - 1; j >= 0 && at - j <= LINK_DEST_MAX; j--) {
    const ch = cps[j];
    if (ch === ')' || /\s/.test(ch)) break;
    if (ch === '(' && cps[j - 1] === ']') {
      const close = cps.indexOf(')', at);
      return close === -1 || close - j > LINK_DEST_MAX ? at : close + 1;
    }
  }
  let end = at;
  while (end < cps.length && end - at < CLOSERS_MAX && (CLOSERS.has(cps[end]) || SENTENCE_END.has(cps[end]))) end++;
  return end > at && closesSentence(cps, at, end) ? end : at;
}

/**
 * Insert a private-use marker after each cited span, carrying the source's
 * 1-based display number. The offsets are code points (how the API counts),
 * so they are converted to string indexes once; inserting from the right
 * keeps the earlier indexes valid. Citations past the end of the text are
 * dropped.
 *
 * The marker is inserted at render time only — `content` stays clean, so
 * copy / TTS / share / export never see it.
 */
export function insertCitationMarkers(markdown: string, citations: readonly WebCitation[]): string {
  if (!markdown || !citations.length) return markdown;
  const cps = Array.from(markdown);
  const prefix = new Array<number>(cps.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < cps.length; i++) prefix[i + 1] = prefix[i] + cps[i].length;

  const marks = new Map<number, number[]>();
  for (const c of citations) {
    const end = Math.trunc(c.end);
    if (!(end > 0) || end > cps.length) continue;
    const at = nudge(cps, end);
    const list = marks.get(at);
    if (list) list.push(c.source);
    else marks.set(at, [c.source]);
  }

  let out = markdown;
  for (const at of [...marks.keys()].sort((a, b) => b - a)) {
    // The marker carries the 1-based display number; `source` is a 0-based
    // index into WebResult.sources.
    const text = marks.get(at)!.map((n) => `${MARK_START}${n + 1}${MARK_END}`).join('');
    out = out.slice(0, prefix[at]) + text + out.slice(prefix[at]);
  }
  return out;
}
