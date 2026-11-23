/**
 * F15 · replay of a REAL deep-search stream through the real provider.
 *
 * tests/fixtures/web-search/deep-search.sse was captured on 2026-11-23 from
 * the live API (deepseek-flash, thinking on) while the built extension was
 * driven end to end (docs/design/设计方案_F15_联网搜索.md §11). It is trimmed
 * only where bulk carries no information: result lists keep up to 5 results
 * plus every cited one (snippets cut to 60 chars), the reasoning keeps its
 * first two chunks, and the 435 text deltas are merged into 60-code-point
 * chunks. The answer text, every progress event, the final chunk (calls +
 * citations) and the usage are exactly what the API sent.
 *
 * The hand-written samples in openai.test.ts pin the documented shape; this
 * file pins the shape as it really comes over the wire — including the things
 * the docs do not spell out (completions arriving out of order, three sources
 * for one sentence, every cited span ending BEFORE its "。").
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openaiProvider } from '../../../src/background/providers/openai';
import { CITATION_MARKER_RE, insertCitationMarkers, safeHttpUrl } from '../../../src/shared/web-search';
import { renderMarkdown } from '../../../src/shared/markdown';
import type { ChatDelta } from '../../../src/background/providers/types';
import type { WebResult } from '../../../src/shared/types';

type FinishDelta = Extract<ChatDelta, { type: 'finish' }>;
type SearchEventDelta = Extract<ChatDelta, { type: 'search_event' }>;
type ThinkingDelta = Extract<ChatDelta, { type: 'thinking' }>;

const SSE = readFileSync(join(__dirname, '../../fixtures/web-search/deep-search.sse'), 'utf8');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const is = <T extends ChatDelta['type']>(type: T) => (d: ChatDelta): d is Extract<ChatDelta, { type: T }> => d.type === type;
const searchEvents = is('search_event');
const texts = is('text');
const thinkings = is('thinking');

async function replay(): Promise<ChatDelta[]> {
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(new Response(SSE, { status: 200 }));
  const out: ChatDelta[] = [];
  const req = { model: 'deepseek-flash', messages: [{ role: 'user' as const, content: 'q' }], webSearch: { rule: 'RULE', reminder: 'REM' } };
  for await (const d of openaiProvider.stream({ apiKey: 'sk', apiBase: 'https://api.test' }, req, new AbortController().signal)) out.push(d);
  return out;
}

/** Every marker in `marked`: its source number and its position in the text WITHOUT markers. */
function markerPositions(marked: string): { n: number; at: number }[] {
  const cps = Array.from(marked);
  const marks: { n: number; at: number }[] = [];
  let stripped = 0;
  for (let i = 0; i < cps.length;) {
    if (cps[i] === '\uE000') { marks.push({ n: Number(cps[i + 1]), at: stripped }); i += 3; }
    else { stripped++; i++; }
  }
  return marks;
}

describe('F15 · a real deep-search stream (captured 2026-11-23)', () => {
  let out: ChatDelta[];
  let events: SearchEventDelta['event'][];
  let finish: FinishDelta;
  let web: WebResult;
  let text: string;

  beforeEach(async () => {
    out = await replay();
    events = out.filter(searchEvents).map(d => d.event);
    finish = out.at(-1) as FinishDelta;
    web = finish.web!;
    text = out.filter(texts).map(d => d.text).join('');
  });

  it('streams the 12 progress events in the order they were sent', () => {
    expect(events.map(e => (e.type === 'call_started' ? `${e.call.action.type}@${e.step}` : e.type))).toEqual([
      'step_reasoning_done', 'search@0', 'call_completed',
      'step_reasoning_done', 'open_page@1', 'open_page@1', 'open_page@1', 'search@1',
      'call_completed', 'call_completed', 'call_completed', 'call_completed',
    ]);
  });

  it('completions arrive out of order and are matched to their call by id', () => {
    const started = events.filter(e => e.type === 'call_started');
    const done = events.filter(e => e.type === 'call_completed');
    expect(started.map(e => e.call.index)).toEqual([0, 0, 1, 2, 3]);
    // Within step 1: #1, #3, #0, #2 — not the order they started in.
    expect(done.map(e => e.call.index)).toEqual([0, 1, 3, 0, 2]);
    expect(done.map(e => e.call.id)).toEqual([started[0]!.call.id, started[2]!.call.id, started[4]!.call.id, started[1]!.call.id, started[3]!.call.id]);
    expect(done[1]).toMatchObject({
      type: 'call_completed', step: 1,
      call: { id: started[2]!.call.id, index: 1, status: 'completed', page: { url: 'https://api-docs.deepseek.com/news/news261113/' } },
    });
    // A completion carries results / page / status — never the action, never a signature.
    for (const e of done) {
      expect(e.call).not.toHaveProperty('action');
      expect(e.call).not.toHaveProperty('signature');
    }
    expect(done.filter(e => e.call.sources?.length).length).toBe(2);  // the two searches
    expect(done.filter(e => e.call.page).length).toBe(3);             // the three opened pages
  });

  it('the final chunk becomes the web record: 5 calls, 2 searches, 3 pages', () => {
    expect(finish.type).toBe('finish');
    expect(finish.reason).toBe('stop');
    expect(web.steps.map(s => s.action.type)).toEqual(['search', 'open_page', 'open_page', 'open_page', 'search']);
    expect(web.steps.every(s => s.status === 'completed')).toBe(true);
    expect(new Set(web.steps.map(s => s.id)).size).toBe(5);
    expect(web).toMatchObject({ searches: 2, pages: 3 });
    // (The API's usage.server_tool_use.tool_search for this stream is 7 — the QUERIES: 4 + 3 — not the 2 calls.)
    expect(finish.usage).toEqual({ inputTokens: 20729, outputTokens: 1080 });
    // Per-step reasoning is not part of the record.
    expect(JSON.stringify(web)).not.toContain('reasoning_content');
  });

  it('every cited source is resolved to the search result it came from', () => {
    expect(web.sources.map(s => s.siteName)).toEqual(['DeepSeek', 'IT之家', 'DeepSeek', '快科技', '21财经', 'Wccftech', 'Emergent']);
    expect(web.sources.map(s => s.title.slice(0, 12).trimEnd())).toEqual([
      'DeepSeek 发布全', 'DeepSeek API', 'The full Dee', '期待已久的大的终于出现了', 'DeepSeek V5：', 'China Going', 'DeepSeek V5',
    ]);
    expect(web.sources.every(s => safeHttpUrl(s.url) === s.url)).toBe(true);
    // The API's ranges, verbatim — three sources share the last sentence.
    expect(web.citations).toEqual([
      { start: 0, end: 50, source: 0 },
      { start: 50, end: 203, source: 1 },
      { start: 203, end: 245, source: 2 },
      { start: 245, end: 538, source: 3 },
      { start: 538, end: 686, source: 4 },
      { start: 538, end: 686, source: 5 },
      { start: 538, end: 686, source: 6 },
    ]);
  });

  it('the answer text and the reasoning arrive intact', () => {
    expect(Array.from(text)).toHaveLength(803);
    expect(text.startsWith('你读的这篇文章发布于 **2026年11月13日**')).toBe(true);
    expect(out.filter(thinkings).map((d: ThinkingDelta) => d.text).join('')).toBe('用户想知道');
  });

  it('the request declared the tool and nothing else', () => {
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.tools).toEqual([{ type: 'deepseek_web_search' }]);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'latest_reminder', 'user']);
  });

  it('on the real answer: one chip per citation, placed after the sentence punctuation, text intact', () => {
    const marked = insertCitationMarkers(text, web.citations);
    const marks = markerPositions(marked);
    expect(marks.map(m => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Every cited span ends right before its "。" → the chip lands one code point further.
    expect(marks.map(m => m.at)).toEqual(web.citations.map(c => c.end + 1));
    const cps = Array.from(text);
    expect(marks.every(m => cps[m.at - 1] === '。')).toBe(true);
    // Removing the markers gives the stored Markdown back, untouched …
    expect(marked.replace(CITATION_MARKER_RE, '')).toBe(text);
    // … and marked + DOMPurify keep every marker (they are ordinary text to both).
    expect((renderMarkdown(marked).match(/\uE000/g) ?? []).length).toBe(7);
  });
});
