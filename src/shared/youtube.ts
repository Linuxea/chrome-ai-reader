/**
 * F3 — YouTube transcripts. Pure parsing helpers; the content script
 * (content/youtube.ts) does the fetching.
 *
 * The watch page's HTML embeds `ytInitialPlayerResponse`, whose
 * `captions.playerCaptionsTracklistRenderer.captionTracks` lists the caption
 * tracks (manual and auto-generated `kind: 'asr'`), each with a timedtext
 * `baseUrl`. `&fmt=json3` returns JSON events; without it, XML `<text>`
 * nodes. The transcript is grouped into ~PARAGRAPH_SECONDS paragraphs, each
 * prefixed with its timestamp, so `[#N]` citations land on a moment.
 */

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: string;
}

export interface Cue {
  startMs: number;
  text: string;
}

export const PARAGRAPH_SECONDS = 45;

/** Video id of a YouTube watch / youtu.be / shorts / embed / live URL, else null. */
export function youtubeVideoId(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
  return m ? m[2] : null;
}

/** The JSON value (array or object) starting at `start` in `s`, by bracket matching. */
function jsonAt(s: string, start: number): string | null {
  const open = s[start];
  const close = open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Caption tracks listed in a watch page's HTML (empty when the video has none). */
export function parseCaptionTracks(html: string): CaptionTrack[] {
  const key = '"captionTracks":';
  const at = html.indexOf(key);
  if (at < 0) return [];
  const raw = jsonAt(html, at + key.length);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as { baseUrl?: string; languageCode?: string; kind?: string; name?: { simpleText?: string; runs?: { text: string }[] } }[];
    return list.filter((t) => t.baseUrl).map((t) => ({
      baseUrl: t.baseUrl!,
      languageCode: t.languageCode ?? '',
      kind: t.kind,
      name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text).join('') ?? '',
    }));
  } catch {
    return [];
  }
}

/**
 * Best track: manual captions beat auto-generated ones; within that, the
 * preferred language (by prefix, `zh` matches `zh-Hans`), then English, then
 * whatever comes first.
 */
export function pickCaptionTrack(tracks: CaptionTrack[], preferredLang = 'en'): CaptionTrack | null {
  if (!tracks.length) return null;
  const lang = preferredLang.toLowerCase().split('-')[0];
  const score = (t: CaptionTrack) => {
    const code = t.languageCode.toLowerCase();
    let s = t.kind === 'asr' ? 0 : 10;
    if (code.split('-')[0] === lang) s += 5;
    else if (code.startsWith('en')) s += 2;
    return s;
  };
  return tracks.reduce((best, t) => (score(t) > score(best) ? t : best));
}

/** Cues from a timedtext `fmt=json3` body. */
export function cuesFromJson3(body: string): Cue[] {
  let data: { events?: { tStartMs?: number; segs?: { utf8?: string }[] }[] };
  try { data = JSON.parse(body); } catch { return []; }
  const out: Cue[] = [];
  for (const e of data.events ?? []) {
    const text = (e.segs ?? []).map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ startMs: e.tStartMs ?? 0, text });
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Cues from a timedtext XML body (`<text start="1.2" dur="…">…</text>`). */
export function cuesFromXml(body: string): Cue[] {
  const out: Cue[] = [];
  for (const m of body.matchAll(/<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    // Captions are double-escaped (`&amp;#39;`): decode twice.
    const text = decodeEntities(decodeEntities(m[2])).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) out.push({ startMs: Math.round(parseFloat(m[1]) * 1000), text });
  }
  return out;
}

/** `m:ss` or `h:mm:ss`. */
export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Group cues into timestamped paragraphs of about `seconds` each. */
export function transcriptParagraphs(cues: Cue[], seconds = PARAGRAPH_SECONDS): string[] {
  const out: string[] = [];
  let start = -1;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push(`[${formatTimestamp(start)}] ${buf.join(' ')}`);
    buf = [];
  };
  for (const c of cues) {
    if (start < 0 || c.startMs - start >= seconds * 1000) {
      flush();
      start = c.startMs;
    }
    buf.push(c.text);
  }
  flush();
  return out;
}

/** Seconds of a paragraph's leading `[m:ss]` / `[h:mm:ss]` stamp, else null. */
export function paragraphTimestamp(paragraph: string): number | null {
  const m = paragraph.match(/^\[(\d+(?::\d{2}){1,2})\]/);
  return m ? m[1].split(':').reduce((a, p) => a * 60 + parseInt(p, 10), 0) : null;
}
