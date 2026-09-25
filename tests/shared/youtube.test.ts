import { describe, it, expect } from 'vitest';
import {
  youtubeVideoId, parseCaptionTracks, pickCaptionTrack, cuesFromJson3, cuesFromXml,
  formatTimestamp, transcriptParagraphs, paragraphTimestamp,
} from '../../src/shared/youtube';

describe('youtubeVideoId', () => {
  it('reads watch / youtu.be / shorts / embed URLs', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abc123&t=5')).toBe('abc123');
    expect(youtubeVideoId('https://m.youtube.com/watch?v=xyz')).toBe('xyz');
    expect(youtubeVideoId('https://youtu.be/q-w_e')).toBe('q-w_e');
    expect(youtubeVideoId('https://www.youtube.com/shorts/s1')).toBe('s1');
    expect(youtubeVideoId('https://www.youtube.com/embed/e1?rel=0')).toBe('e1');
  });
  it('rejects other pages', () => {
    expect(youtubeVideoId('https://www.youtube.com/feed/subscriptions')).toBeNull();
    expect(youtubeVideoId('https://example.com/watch?v=abc')).toBeNull();
    expect(youtubeVideoId('not a url')).toBeNull();
  });
});

describe('parseCaptionTracks', () => {
  const html = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[`
    + `{"baseUrl":"https://www.youtube.com/api/timedtext?v=a\\u0026lang=en","name":{"simpleText":"English [auto]"},"languageCode":"en","kind":"asr"},`
    + `{"baseUrl":"https://www.youtube.com/api/timedtext?v=a\\u0026lang=zh-Hans","name":{"runs":[{"text":"Chinese"}]},"languageCode":"zh-Hans"}`
    + `],"audioTracks":[]}}};</script>`;

  it('extracts the tracks, decoding JSON escapes', () => {
    const tracks = parseCaptionTracks(html);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toEqual({ baseUrl: 'https://www.youtube.com/api/timedtext?v=a&lang=en', languageCode: 'en', kind: 'asr', name: 'English [auto]' });
    expect(tracks[1].name).toBe('Chinese');
  });
  it('is empty without captions or on broken JSON', () => {
    expect(parseCaptionTracks('<html></html>')).toEqual([]);
    expect(parseCaptionTracks('"captionTracks":[{"baseUrl":')).toEqual([]);
  });
  it('prefers manual captions, then the preferred language, then English', () => {
    const tracks = parseCaptionTracks(html);
    expect(pickCaptionTrack(tracks, 'zh-CN')?.languageCode).toBe('zh-Hans');
    expect(pickCaptionTrack(tracks, 'fr')?.languageCode).toBe('zh-Hans'); // manual beats asr
    expect(pickCaptionTrack([tracks[0]], 'fr')?.languageCode).toBe('en');
    expect(pickCaptionTrack([], 'en')).toBeNull();
  });
});

describe('cues', () => {
  it('parses json3 events, skipping empty ones', () => {
    const body = JSON.stringify({ events: [
      { tStartMs: 0, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
      { tStartMs: 1500, segs: [{ utf8: '\n' }] },
      { tStartMs: 3000, segs: [{ utf8: 'again' }] },
      { tStartMs: 4000 },
    ] });
    expect(cuesFromJson3(body)).toEqual([{ startMs: 0, text: 'Hello world' }, { startMs: 3000, text: 'again' }]);
    expect(cuesFromJson3('')).toEqual([]);
  });
  it('parses XML, decoding (double-escaped) entities', () => {
    const xml = '<transcript><text start="1.5" dur="2">it&amp;#39;s &lt;fine&gt;</text><text start="4" dur="1"></text><text start="62.25">a &amp;amp; b</text></transcript>';
    expect(cuesFromXml(xml)).toEqual([{ startMs: 1500, text: "it's" }, { startMs: 62250, text: 'a & b' }]);
  });
});

describe('transcript paragraphs', () => {
  it('formats timestamps', () => {
    expect(formatTimestamp(5_000)).toBe('0:05');
    expect(formatTimestamp(65_900)).toBe('1:05');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
  });
  it('groups cues into timestamped windows', () => {
    const cues = [{ startMs: 0, text: 'a' }, { startMs: 10_000, text: 'b' }, { startMs: 46_000, text: 'c' }, { startMs: 50_000, text: 'd' }];
    expect(transcriptParagraphs(cues, 45)).toEqual(['[0:00] a b', '[0:46] c d']);
    expect(transcriptParagraphs([])).toEqual([]);
  });
  it('reads a paragraph timestamp back', () => {
    expect(paragraphTimestamp('[1:05] hi')).toBe(65);
    expect(paragraphTimestamp('[1:02:05] hi')).toBe(3725);
    expect(paragraphTimestamp('no stamp')).toBeNull();
  });
});
