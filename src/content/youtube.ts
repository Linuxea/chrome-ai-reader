/**
 * F3 — fetch a YouTube video's transcript from inside the watch page.
 *
 * The content script runs in an isolated world and cannot read the page's
 * `ytInitialPlayerResponse` variable, so it re-fetches the watch page's HTML
 * (same origin, fresh for SPA navigations) and reads the caption tracks from
 * it (shared/youtube.ts). If the timedtext endpoint returns nothing (YouTube
 * sometimes demands a token it adds from JS), the transcript panel's DOM is
 * the fallback when the user has it open.
 */

import {
  youtubeVideoId, parseCaptionTracks, pickCaptionTrack, cuesFromJson3, cuesFromXml,
  transcriptParagraphs, type Cue,
} from '../shared/youtube';

export interface Transcript {
  paragraphs: string[];
  language: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include' });
  return res.ok ? res.text() : '';
}

/** Cues from the open "Show transcript" panel, if any. */
export function cuesFromTranscriptPanel(root: ParentNode = document): Cue[] {
  const out: Cue[] = [];
  for (const seg of root.querySelectorAll('ytd-transcript-segment-renderer')) {
    const stamp = seg.querySelector('.segment-timestamp')?.textContent?.trim() ?? '';
    const text = seg.querySelector('.segment-text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!text) continue;
    const parts = stamp.split(':').map((p) => parseInt(p, 10));
    const secs = parts.every(Number.isFinite) ? parts.reduce((a, p) => a * 60 + p, 0) : 0;
    out.push({ startMs: secs * 1000, text });
  }
  return out;
}

/** The current video's transcript, or null when it has none we can reach. */
export async function fetchYouTubeTranscript(url = location.href, lang = navigator.language || 'en'): Promise<Transcript | null> {
  if (!youtubeVideoId(url)) return null;
  try {
    const track = pickCaptionTrack(parseCaptionTracks(await fetchText(url)), lang);
    if (track) {
      let cues = cuesFromJson3(await fetchText(track.baseUrl + '&fmt=json3'));
      if (!cues.length) cues = cuesFromXml(await fetchText(track.baseUrl));
      if (cues.length) return { paragraphs: transcriptParagraphs(cues), language: track.languageCode };
    }
  } catch {
    // Network / parse failure → try the panel below.
  }
  const panel = cuesFromTranscriptPanel();
  return panel.length ? { paragraphs: transcriptParagraphs(panel), language: '' } : null;
}

/** The video description shown under the player (best effort). */
export function videoDescription(root: ParentNode = document): string {
  const el = root.querySelector('#description-inline-expander, ytd-text-inline-expander, #description');
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
