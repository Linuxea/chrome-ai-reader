import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchYouTubeTranscript, cuesFromTranscriptPanel, videoDescription } from '../../src/content/youtube';

const WATCH = 'https://www.youtube.com/watch?v=vid1';
const html = '"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=vid1","languageCode":"en"}]';

function mockFetch(bodies: Record<string, string>) {
  const f = vi.fn(async (url: string) => {
    const body = bodies[url];
    return { ok: body !== undefined, text: async () => body ?? '' } as Response;
  });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => vi.unstubAllGlobals());

describe('fetchYouTubeTranscript', () => {
  it('reads the caption track as json3', async () => {
    const f = mockFetch({
      [WATCH]: html,
      'https://www.youtube.com/api/timedtext?v=vid1&fmt=json3': JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'hi' }] }] }),
    });
    expect(await fetchYouTubeTranscript(WATCH, 'en')).toEqual({ paragraphs: ['[0:00] hi'], language: 'en' });
    expect(f).toHaveBeenCalledWith(WATCH, { credentials: 'include' });
  });

  it('falls back to XML when json3 is empty', async () => {
    mockFetch({
      [WATCH]: html,
      'https://www.youtube.com/api/timedtext?v=vid1&fmt=json3': '',
      'https://www.youtube.com/api/timedtext?v=vid1': '<text start="3">xml cue</text>',
    });
    expect((await fetchYouTubeTranscript(WATCH, 'en'))?.paragraphs).toEqual(['[0:03] xml cue']);
  });

  it('falls back to the open transcript panel, then to null', async () => {
    mockFetch({ [WATCH]: '<html></html>' });
    expect(await fetchYouTubeTranscript(WATCH)).toBeNull();
    document.body.innerHTML = `
      <ytd-transcript-segment-renderer><div class="segment-timestamp">1:02</div><div class="segment-text">panel text</div></ytd-transcript-segment-renderer>`;
    expect(await fetchYouTubeTranscript(WATCH)).toEqual({ paragraphs: ['[1:02] panel text'], language: '' });
  });

  it('ignores non-video pages and network errors', async () => {
    expect(await fetchYouTubeTranscript('https://example.com/')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await fetchYouTubeTranscript(WATCH)).toBeNull();
  });
});

describe('page helpers', () => {
  it('parses panel timestamps with hours', () => {
    document.body.innerHTML = `<ytd-transcript-segment-renderer><span class="segment-timestamp">1:00:01</span><span class="segment-text"> a  b </span></ytd-transcript-segment-renderer>`;
    expect(cuesFromTranscriptPanel()).toEqual([{ startMs: 3_601_000, text: 'a b' }]);
  });
  it('reads the description', () => {
    document.body.innerHTML = '<div id="description"> About   this video </div>';
    expect(videoDescription()).toBe('About this video');
  });
});
