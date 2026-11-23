/**
 * F15 web search — the pure helpers in shared/web-search.ts.
 *
 * The wire samples below follow the shapes recorded from the live DeepSeek
 * API on 2026-11-23 (docs/design/设计方案_F15_联网搜索.md §10).
 */
import { describe, it, expect } from 'vitest';
import {
  parseServerToolEvent, buildWebResult, webResultFromSteps,
  insertCitationMarkers, CITATION_MARKER_RE, safeHttpUrl,
} from '../../src/shared/web-search';

const STARTED = {
  type: 'call_started', step: 0,
  call: { index: 0, id: 'srvtoolu_00', type: 'deepseek_web_search', kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] } },
};
const OPEN_STARTED = {
  type: 'call_started', step: 1,
  call: { index: 2, id: 'srvtoolu_03', type: 'deepseek_web_search', kind: 'deep_search', action: { type: 'open_page', url: 'https://x.test/p' } },
};
const OPEN_COMPLETED = {
  type: 'call_completed', step: 1,
  call: { index: 2, id: 'srvtoolu_03', type: 'deepseek_web_search', kind: 'deep_search', action: { type: 'open_page', url: 'https://x.test/p' },
    status: 'completed', page: { url: 'https://x.test/p', title: 'Page title', published_at: '2026-11-17T16:00:00+00:00' } },
};

/** The last chunk's `delta.server_tool_calls` + `delta.annotations`, as the API sends them. */
const LAST_CHUNK = {
  server_tool_calls: [
    { index: 0, reasoning_content: '用户想知道…', calls: [
      { index: 0, id: 'srvtoolu_00', type: 'deepseek_web_search', kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] }, status: 'completed',
        sources: [
          { type: 'url', url: 'https://a.test/1', title: 'A one', snippet: '…', site_name: 'A', site_icon: 'https://…', published_at: '2026-11-08T16:00:00+00:00' },
          { type: 'url', url: 'https://b.test/2', title: null, snippet: '…', site_name: null, site_icon: null, published_at: null },
        ] },
    ] },
    { index: 1, reasoning_content: '', calls: [
      { index: 2, id: 'srvtoolu_03', type: 'deepseek_web_search', kind: 'deep_search', action: { type: 'open_page', url: 'https://a.test/1' },
        status: 'completed', page: { url: 'https://a.test/1', title: 'A one', published_at: '2026-11-08T16:00:00+00:00' } },
    ] },
  ],
  annotations: [
    { type: 'url_citation', url_citation: { url: 'https://a.test/1', title: 'A one', start_index: 0, end_index: 12 } },
    { type: 'url_citation', url_citation: { url: 'https://new.test/x', title: 'Not in any result', start_index: 12, end_index: 30 } },
    { type: 'url_citation', url_citation: { url: 'https://a.test/1', title: 'A one', start_index: 12, end_index: 30 } },
  ],
};

describe('parseServerToolEvent', () => {
  it('normalizes the three event kinds and strips what is not needed', () => {
    expect(parseServerToolEvent({ type: 'step_reasoning_done', step: 3 })).toEqual({ type: 'step_reasoning_done', step: 3 });
    expect(parseServerToolEvent(STARTED)).toEqual({
      type: 'call_started', step: 0,
      call: { id: 'srvtoolu_00', index: 0, kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] } },
    });
    // call_completed: only id / index / status / page survive (no action, no signature).
    expect(parseServerToolEvent(OPEN_COMPLETED)).toEqual({
      type: 'call_completed', step: 1,
      call: { id: 'srvtoolu_03', index: 2, status: 'completed', page: { url: 'https://x.test/p', title: 'Page title' } },
    });
  });

  it('reads search results, failures and defaults', () => {
    const done = parseServerToolEvent({
      type: 'call_completed', step: 0,
      call: { index: 0, id: 's1', status: 'completed', sources: [
        { type: 'url', url: 'https://a.test/1', title: 'A', site_name: 'A site' },
        { type: 'url', url: 'https://b.test/2', title: null, site_name: null },
        { type: 'web_search_tool_result_error', error_code: 'unavailable' },
      ] },
    });
    expect(done).toEqual({
      type: 'call_completed', step: 0,
      call: { id: 's1', index: 0, status: 'completed', sources: [
        { url: 'https://a.test/1', title: 'A', siteName: 'A site' },
        { url: 'https://b.test/2', title: 'https://b.test/2' },
      ] },
    });
    const failed = parseServerToolEvent({ type: 'call_completed', step: 0, call: { id: 's2', status: 'failed', error: { code: 'url_not_accessible' } } });
    expect(failed).toEqual({ type: 'call_completed', step: 0, call: { id: 's2', index: 0, status: 'failed', error: 'url_not_accessible' } });
    // Unknown kind → plain search; a non-integer step → 0.
    expect(parseServerToolEvent({ type: 'call_started', step: 'x', call: { id: 's3', kind: 'something_new', action: { type: 'search', queries: [] } } }))
      .toEqual({ type: 'call_started', step: 0, call: { id: 's3', index: 0, kind: 'search', action: { type: 'search', queries: [] } } });
    expect(parseServerToolEvent({ type: 'call_started', step: 0, call: { id: 's4', action: { type: 'find_in_page', url: 'https://x.test/', pattern: '330' } } })?.call)
      .toMatchObject({ action: { type: 'find_in_page', url: 'https://x.test/', pattern: '330' } });
  });

  it('drops anything that is not a well-formed event instead of throwing', () => {
    expect(parseServerToolEvent(undefined)).toBeNull();
    expect(parseServerToolEvent('call_started')).toBeNull();
    expect(parseServerToolEvent({ type: 'call_started' })).toBeNull();           // no call
    expect(parseServerToolEvent({ type: 'call_started', call: { index: 0 } })).toBeNull(); // no id
    expect(parseServerToolEvent({ type: 'call_started', call: { id: 'x', action: { type: 'teleport' } } })).toBeNull();
    expect(parseServerToolEvent({ type: 'call_started', call: { id: 'x', action: { type: 'open_page' } } })).toBeNull(); // no url
    expect(parseServerToolEvent({ type: 'something_new', step: 0 })).toBeNull();
  });
});

describe('webResultFromSteps', () => {
  const search = { id: 's1', kind: 'search' as const, action: { type: 'search' as const, queries: ['a', 'b', 'c'] }, status: 'completed' as const };
  const open = (url: string): Parameters<typeof webResultFromSteps>[0][number] =>
    ({ id: `open-${url}`, kind: 'deep_search', action: { type: 'open_page', url }, status: 'completed' });

  it('is undefined without steps', () => {
    expect(webResultFromSteps([])).toBeUndefined();
  });

  it('counts search CALLS (not queries) and distinct opened pages', () => {
    // One search call with three queries → 1 (the API's usage.tool_search would say 3).
    const r = webResultFromSteps([search, open('https://a.test'), open('https://a.test'), open('https://b.test')])!;
    expect(r.searches).toBe(1);
    expect(r.pages).toBe(2);
    expect(r).toMatchObject({ steps: [search, open('https://a.test'), open('https://a.test'), open('https://b.test')], sources: [], citations: [] });
  });
});

describe('buildWebResult', () => {
  it('is undefined when the model did not use the web', () => {
    expect(buildWebResult(undefined, undefined)).toBeUndefined();
    expect(buildWebResult([], [])).toBeUndefined();
    expect(buildWebResult('garbage', { no: [] })).toBeUndefined();
  });

  it('flattens the last chunk into ordered steps and drops per-step reasoning', () => {
    const r = buildWebResult(LAST_CHUNK.server_tool_calls, [])!;
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0]).toEqual({
      id: 'srvtoolu_00', kind: 'deep_search', status: 'completed',
      action: { type: 'search', queries: ['q1', 'q2'] },
      sources: [
        { url: 'https://a.test/1', title: 'A one', siteName: 'A' },
        { url: 'https://b.test/2', title: 'https://b.test/2' },
      ],
    });
    expect(r.steps[1]).toMatchObject({ id: 'srvtoolu_03', action: { type: 'open_page', url: 'https://a.test/1' }, page: { url: 'https://a.test/1', title: 'A one' } });
    expect(JSON.stringify(r)).not.toContain('reasoning_content');
    expect(r).toMatchObject({ searches: 1, pages: 1 });
  });

  it('de-duplicates cited sources by URL in first-cited order and places the citations', () => {
    const r = buildWebResult(LAST_CHUNK.server_tool_calls, LAST_CHUNK.annotations)!;
    // a.test/1 (cited twice) then new.test/x.
    expect(r.sources).toEqual([
      { url: 'https://a.test/1', title: 'A one', siteName: 'A' },
      { url: 'https://new.test/x', title: 'Not in any result' },
    ]);
    expect(r.citations).toEqual([
      { start: 0, end: 12, source: 0 },
      { start: 12, end: 30, source: 1 },
      { start: 12, end: 30, source: 0 },
    ]);
  });

  it('falls back to the URL when a citation has no usable title', () => {
    const ann = [{ type: 'url_citation', url_citation: { url: 'https://c.test/3', title: 'https://c.test/3', start_index: 0, end_index: 5 } }];
    expect(buildWebResult([], ann)!.sources).toEqual([{ url: 'https://c.test/3', title: 'https://c.test/3' }]);
    // And borrows the title of a search result it was not credited to, when the URL matches.
    const viaStep = buildWebResult([{ index: 0, calls: [{ id: 's', action: { type: 'search', queries: [] }, status: 'completed', sources: [{ url: 'https://d.test/4', title: 'D title', site_name: 'D' }] }] }],
      [{ type: 'url_citation', url_citation: { url: 'https://d.test/4', title: 'https://d.test/4', start_index: 0, end_index: 1 } }])!;
    expect(viaStep.sources).toEqual([{ url: 'https://d.test/4', title: 'D title', siteName: 'D' }]);
  });

  it('skips malformed annotations and keeps the rest', () => {
    const ann = [
      { type: 'url_citation', url_citation: { url: 'https://ok.test/', start_index: 0, end_index: 3 } },
      { type: 'url_citation', url_citation: { url: '', start_index: 0, end_index: 3 } },
      { type: 'url_citation', url_citation: { url: 'https://x.test/', start_index: '0', end_index: 3 } },
      { type: 'url_citation', url_citation: { url: 'https://x.test/', start_index: -1, end_index: 3 } },
      { type: 'url_citation' },
      'junk',
    ];
    const r = buildWebResult(undefined, ann)!;
    expect(r.citations).toEqual([{ start: 0, end: 3, source: 0 }]);
    expect(r.sources).toEqual([{ url: 'https://ok.test/', title: 'https://ok.test/' }]);
  });
});

describe('insertCitationMarkers', () => {
  // `source` is a 0-based index into WebResult.sources; the marker shows it 1-based.
  const cite = (end: number, source = 0) => ({ start: 0, end, source });

  it('returns the text unchanged when there is nothing to mark', () => {
    expect(insertCitationMarkers('', [cite(1)])).toBe('');
    expect(insertCitationMarkers('hello', [])).toBe('hello');
  });

  it('inserts a private-use marker carrying the 1-based source number after the cited span', () => {
    const out = insertCitationMarkers('abcdefgh', [cite(3)]);
    expect(out).toBe('abc\uE0001\uE001defgh');
    expect(insertCitationMarkers('ab', [cite(2, 2)])).toBe('ab\uE0003\uE001');
    // The marker survives as ordinary text for a Markdown renderer and never
    // occurs in model output by accident.
    expect(out.replace(CITATION_MARKER_RE, '')).toBe('abcdefgh');
    expect([...out.matchAll(CITATION_MARKER_RE)].map(m => m[1])).toEqual(['1']);
  });

  it('counts offsets in code points, the way the API does', () => {
    // 🌟 is one code point but two UTF-16 units: offset 3 is after "b🌟c".
    const out = insertCitationMarkers('a🌟cd', [cite(3)]);
    expect(Array.from(out)).toEqual(['a', '🌟', 'c', '\uE000', '1', '\uE001', 'd']);
  });

  it('places several citations correctly by inserting from the right', () => {
    const out = insertCitationMarkers('0123456789', [cite(2, 0), cite(7, 1)]);
    expect(out).toBe('01\uE0001\uE00123456\uE0002\uE001789');
  });

  it('puts citations that share a position next to each other, in order', () => {
    // Three sources for one sentence is what the API returns for a single search.
    const out = insertCitationMarkers('one sentence', [cite(12, 0), cite(12, 1), cite(12, 2)]);
    expect(out).toBe('one sentence\uE0001\uE001\uE0002\uE001\uE0003\uE001');
  });

  it('drops citations that end outside the text', () => {
    const out = insertCitationMarkers('abc', [cite(4), cite(0), { start: 0, end: NaN, source: 0 }, cite(2.9, 4)]);
    expect(out).toBe('ab\uE0005\uE001c');
  });

  it('never splits an emphasis delimiter run (E-07)', () => {
    // The span ends between the two asterisks of a closing `**`.
    const out = insertCitationMarkers('**bold** rest', [cite(7)]);
    expect(out).toBe('**bold**\uE0001\uE001 rest');
    // A closing `*` of italics, and an inline-code backtick.
    expect(insertCitationMarkers('*it* x', [cite(4)])).toBe('*it*\uE0001\uE001 x');
    expect(insertCitationMarkers('`code` x', [cite(6)])).toBe('`code`\uE0001\uE001 x');
    // Ending just before a single closing delimiter is fine as it is: the
    // delimiter still closes its emphasis (a private-use char is neither
    // whitespace nor punctuation), so the position is left alone.
    expect(insertCitationMarkers('*it* x', [cite(3)])).toBe('*it\uE0001\uE001* x');
  });

  it('never lands inside a link destination (E-07)', () => {
    const md = 'see [page](https://example.com/a?b=c) now';
    const inside = md.indexOf(') now');   // between the URL and the closing paren
    expect(insertCitationMarkers(md, [cite(inside)])).toBe('see [page](https://example.com/a?b=c)\uE0001\uE001 now');
    // After the closing paren there is nothing to nudge out of.
    expect(insertCitationMarkers(md, [cite(inside + 1)])).toBe('see [page](https://example.com/a?b=c)\uE0001\uE001 now');
  });

  it('leaves ordinary punctuation and CJK text alone', () => {
    const out = insertCitationMarkers('结论甲。结论乙', [cite(4, 1)]);
    expect(out).toBe('结论甲。\uE0002\uE001结论乙');
  });

  it('places the marker AFTER the sentence\'s closing punctuation', () => {
    // The API ends a cited span BEFORE its "。" (all 7 citations of the stream
    // captured on 2026-11-23 do); the chip reads better after it.
    expect(insertCitationMarkers('结论甲。结论乙', [cite(3)])).toBe('结论甲。\uE0001\uE001结论乙');
    // … also past a closing quote / bracket that precedes the full stop.
    expect(insertCitationMarkers('他说“好了”。然后', [cite(5)])).toBe('他说“好了”。\uE0001\uE001然后');
    expect(insertCitationMarkers('Done (see note). Next', [cite(15)])).toBe('Done (see note).\uE0001\uE001 Next');
    expect(insertCitationMarkers('Really? Yes', [cite(6)])).toBe('Really?\uE0001\uE001 Yes');
    // A span that ends after the punctuation, or mid-sentence, is left where it is.
    expect(insertCitationMarkers('结论甲。结论乙', [cite(4)])).toBe('结论甲。\uE0001\uE001结论乙');
    expect(insertCitationMarkers('结论甲，结论乙', [cite(3)])).toBe('结论甲\uE0001\uE001，结论乙');
  });

  it('does not mistake a decimal point or an abbreviation for a sentence end', () => {
    expect(insertCitationMarkers('pi is 3.14 ok', [cite(7)])).toBe('pi is 3\uE0001\uE001.14 ok');
    expect(insertCitationMarkers('e.g. this', [cite(1)])).toBe('e\uE0001\uE001.g. this');
    // An ASCII full stop that is not followed by whitespace stays on the safe
    // side too (it may be "3.14" or "e.g." — only "。" is unambiguous).
    expect(insertCitationMarkers('第一句.第二句', [cite(3)])).toBe('第一句\uE0001\uE001.第二句');
    expect(insertCitationMarkers('第一句。第二句', [cite(3)])).toBe('第一句。\uE0001\uE001第二句');
  });
});

describe('safeHttpUrl', () => {
  it('accepts absolute http(s) URLs only', () => {
    expect(safeHttpUrl('https://a.test/x')).toBe('https://a.test/x');
    expect(safeHttpUrl('http://a.test')).toBe('http://a.test');
    // A citation URL comes from the API response: none of these may become an href.
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl('chrome://settings')).toBeNull();
    expect(safeHttpUrl('javascript&#58;alert(1)')).toBeNull();
    expect(safeHttpUrl('//a.test/x')).toBeNull();
    expect(safeHttpUrl('https://a.test/has space')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});
