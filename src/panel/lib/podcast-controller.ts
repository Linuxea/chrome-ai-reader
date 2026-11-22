/**
 * Podcast controller — React port of `side_panel/features/podcast/`
 * (index.ts + script.ts + audio.ts + now-playing.ts orchestration).
 *
 * One podcast stream exists per side-panel window: the chrome Port pair,
 * the HTMLAudioElement + MediaSource pipeline and the byte buffers live as
 * module-level singletons here (exactly like the legacy audio.ts), while
 * every UI-visible fact is written into `podcast-store` — components
 * derive from the store, so the legacy DOM tricks (card reattachment on
 * PODCAST_REBUILD_REQUEST, `_activeCard` pointers, cached progress refs)
 * are simply unnecessary: returning to the origin tab re-renders the card
 * from `nowPlaying`, and switching away never stops playback.
 *
 * Kept verbatim from the legacy implementation:
 * - click flow: guards → attachments → selection-or-page text →
 *   ensurePageContent → LLM script (dual port, disconnect-resilient) →
 *   JSON parse with repair + regex fallback → audio port (base64 chunks,
 *   ordered MSE queue, per-round timings) → MediaSource playback;
 * - the isPodcastGenerating flag lives on the ORIGIN tab (may be a
 *   background tab when the user switches away mid-generation);
 * - TTS mutual exclusion in both directions: starting a podcast stops TTS
 *   (defensive call into tts-controller), and a TTS start signals
 *   `stopPodcastForTTS()` — cancel while generating, pause-keep-buffers
 *   while playing (replay/download stay available).
 */
import { t, getCurrentLang } from '@/shared/i18n.js';
import { getPrompt } from '@/shared/prompts';
import { stripMarkdownFence, extractJsonObject, repairLLMJson } from '@/shared/json-repair';
import { downloadFile } from '@/shared/download';
import { safePortDisconnect, safeEndOfStream } from '@/shared/chrome-helpers';
import type { PodcastLLMRequest } from '@/shared/protocol';
import { openAIChatPort, openPodcastLLMPort, openPodcastAudioPort } from '@/platform/ports';
import * as core from '@/panel/state';
import { ensurePageContent } from '@/panel/lib/page-extractor';
// Defensive on purpose: tts-controller is authored concurrently with this
// file. The double cast keeps working whether or not `stopAllTTS` exists.
import * as ttsController from '@/panel/lib/tts-controller';
import {
  usePodcastStore,
  getNowPlaying,
  isNowPlayingGenerating,
  subscribePodcastStop,
  stopPodcastForTTS,
  type NlpRound,
  type PodcastStatus,
  type RoundTiming,
} from '@/panel/stores/podcast-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { useComposerStore } from '@/panel/stores/composer-store';

// --- constants (duplicated from features/podcast/constants.ts — that file
// sits in a layer panel/ may not import) --------------------------------------

const SPEAKER_MAP: Record<string, string> = {
  'A': 'zh_male_dayixiansheng_v2_saturn_bigtts',
  'B': 'zh_female_mizaitongxue_v2_saturn_bigtts',
};
const DEFAULT_SPEAKER = 'zh_female_mizaitongxue_v2_saturn_bigtts';
const MAX_CHUNK_QUEUE_SIZE = 50;

// --- pure helpers (exported for tests) ----------------------------------------

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Index of the transcript round covering `time` (-1 when unknown). */
export function roundIndexAt(time: number, timings: RoundTiming[]): number {
  if (timings.length === 0) return -1;
  for (let i = 0; i < timings.length; i++) {
    if (time >= timings[i].startTime && time < timings[i].endTime) return i;
  }
  if (time >= timings[timings.length - 1].endTime) return timings.length - 1;
  return -1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateAndMapRounds(parsed: any): NlpRound[] {
  if (!parsed.rounds || !Array.isArray(parsed.rounds) || parsed.rounds.length === 0) throw new Error('Empty rounds array');
  return parsed.rounds.map((round: { speaker?: string; text?: string }) => {
    if (!round.speaker || !round.text) throw new Error('Missing speaker or text in round');
    const speakerLabel = round.speaker.toUpperCase();
    const speaker = SPEAKER_MAP[round.speaker] || SPEAKER_MAP[speakerLabel] || DEFAULT_SPEAKER;
    const text = (round.text || '').slice(0, 280);
    return { speaker, text, speakerLabel };
  });
}

/** Last-resort extractor: scan the raw text for "speaker":"A" pairs when the
 *  JSON is too broken for even the repaired parse. */
export function extractRoundsFallback(jsonStr: string): NlpRound[] {
  const rounds: NlpRound[] = [];
  const speakerRe = /"speaker"\s*:\s*"(A|B)"/g;
  let m: RegExpExecArray | null;
  while ((m = speakerRe.exec(jsonStr)) !== null) {
    const letter = m[1];
    const rest = jsonStr.substring(m.index + m[0].length);
    const prefix = rest.match(/^\s*,\s*"text"\s*:\s*"/);
    if (!prefix) continue;
    const src = rest.substring(prefix[0].length);
    let text = '', i = 0;
    while (i < src.length) {
      if (src[i] === '\\') { text += src.substring(i, i + 2); i += 2; continue; }
      if (src[i] === '"' && /^\s*\}/.test(src.substring(i + 1))) break;
      text += src[i]; i++;
    }
    text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const speaker = SPEAKER_MAP[letter] || DEFAULT_SPEAKER;
    text = text.slice(0, 280);
    if (text) rounds.push({ speaker, text, speakerLabel: letter });
  }
  return rounds;
}

/** Parse the LLM's script output: fence strip → object extraction → parse →
 *  repair → regex fallback. Throws when nothing yields a usable round list. */
export function parsePodcastScript(fullScript: string): NlpRound[] {
  let jsonStr = stripMarkdownFence(fullScript);
  const jsonMatch = extractJsonObject(jsonStr, 'rounds');
  if (!jsonMatch) throw new Error('No JSON found in script');
  jsonStr = jsonMatch;

  try { return validateAndMapRounds(JSON.parse(jsonStr)); } catch (originalError) {
    const repaired = repairLLMJson(jsonStr);
    try { return validateAndMapRounds(JSON.parse(repaired)); } catch {
      const rounds = extractRoundsFallback(jsonStr);
      if (rounds.length > 0) return rounds;
      throw new Error(`Invalid JSON: ${(originalError as Error).message}`);
    }
  }
}

/** Derive a filesystem-safe title from the first rounds' text. */
export function extractPodcastTitle(rounds: NlpRound[]): string {
  if (!rounds || rounds.length === 0) return '';
  const firstTexts = rounds.slice(0, 3).map(r => (r.text || '').trim()).filter(Boolean).join(' ');
  let title = firstTexts.replace(/[，。！？、；："'「」『』【】（）《》—…\s]+/g, ' ').trim().slice(0, 60);
  if (title.length > 30) { const lastPunct = title.lastIndexOf(' ', 30); title = title.slice(0, lastPunct > 0 ? lastPunct : 30); }
  return title.replace(/[/\\:*?"<>|]/g, '_').trim();
}

// --- ordered byte queue (MSE feeds one appendBuffer at a time) -----------------

export interface ChunkSink {
  append: (chunk: ArrayBuffer) => void;
}

/**
 * FIFO queue feeding a SourceBuffer: at most one append in flight, next
 * chunk pumped on `notifyAppendEnd()` (the sourcebuffer's `updateend`).
 * Chunks may arrive faster than the sink accepts them — order is still
 * delivery order. Capped: the OLDEST chunk is dropped when full (streaming
 * must not balloon memory), matching the legacy queue. `canAccept` gates
 * the pre-`sourceopen` window: chunks are held (not lost) until the
 * SourceBuffer exists.
 */
export class OrderedChunkQueue {
  private _queue: ArrayBuffer[] = [];
  private _appending = false;

  constructor(
    private readonly _sink: ChunkSink,
    private readonly _max = MAX_CHUNK_QUEUE_SIZE,
    private readonly _canAccept: () => boolean = () => true,
  ) {}

  get length(): number { return this._queue.length; }
  get appending(): boolean { return this._appending; }
  /** Snapshot of the not-yet-appended chunks (tests). */
  get pending(): ArrayBuffer[] { return this._queue.slice(); }

  push(chunk: ArrayBuffer): void {
    if (this._queue.length >= this._max) {
      console.warn('[Podcast] Queue full, dropping oldest chunk');
      this._queue.shift();
    }
    this._queue.push(chunk);
    this.pump();
  }

  /** The sink finished (or failed) one append — feed the next chunk. */
  notifyAppendEnd(): void {
    this._appending = false;
    this.pump();
  }

  pump(): void {
    if (this._appending || this._queue.length === 0) return;
    if (!this._canAccept()) return;
    this._appending = true;
    const chunk = this._queue.shift()!;
    try {
      this._sink.append(chunk);
    } catch (e) {
      // Synchronous throw: the chunk is lost (already shifted) exactly like
      // the legacy queue, but the queue must keep flowing.
      console.error('[Podcast] appendBuffer error:', e);
      this._appending = false;
    }
  }
}

// --- window-global singletons --------------------------------------------------

let llmPort: chrome.runtime.Port | null = null;
let audioPort: chrome.runtime.Port | null = null;
let audioEl: HTMLAudioElement | null = null;
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let chunkQueue: OrderedChunkQueue | null = null;
/** Every received chunk (copies) — the download payload, kept across a
 *  graceful TTS stop so replay/download still work. */
let audioChunks: ArrayBuffer[] = [];
let podcastTitle = '';
let cancelled = false;
/** The tab that started the in-flight session — the isPodcastGenerating
 *  flag must be cleared THERE even if the user switched tabs mid-flow and
 *  nowPlaying is not set yet (extraction phase). */
let sessionOriginTabId: number | null = null;
/** Resolves the pending script promise when a stop tears the port down (our
 *  own disconnect() never fires our onDisconnect — see stream-controller). */
let resolveScriptPromise: (() => void) | null = null;
let playPromise: Promise<void> | null = null;

interface ScriptPortMessage { type: string; content?: string; error?: string; errorKey?: string }
interface AudioPortMessage {
  type: string;
  data?: string;
  audioDuration?: number;
  startTime?: number;
  endTime?: number;
  error?: string;
  errorKey?: string;
}

function store(): ReturnType<typeof usePodcastStore.getState> {
  return usePodcastStore.getState();
}

function setStatus(status: PodcastStatus, statusText?: string): void {
  store().updateNowPlaying({ status, statusText });
}

/**
 * Clear the isPodcastGenerating flag on the ORIGIN tab (which may differ
 * from the active tab when the user switched away mid-generation), falling
 * back to the active tab when no origin is tracked yet.
 */
function resetPodcastState(): void {
  const np = getNowPlaying();
  const originTabId = np?.originTabId ?? sessionOriginTabId;
  if (originTabId != null) {
    const ts = core.getStateForTab(originTabId);
    if (ts) {
      ts.isPodcastGenerating = false;
      core.persistForTab(originTabId);
    }
  } else {
    core.setIsPodcastGenerating(false);
  }
  useTabsStore.getState().bump();
}

/** Free the playback resources (ports, audio element, MSE, buffers) and
 *  reset the playback mirror. Keeps nowPlaying metadata intact. */
function teardownAudio(): void {
  if (audioEl) { audioEl.pause(); audioEl.src = ''; audioEl = null; }
  if (mediaSource) { safeEndOfStream(mediaSource); mediaSource = null; sourceBuffer = null; }
  safePortDisconnect(audioPort);
  audioPort = null;
  chunkQueue = null;
  audioChunks = [];
  podcastTitle = '';
  playPromise = null;
  store().resetPlayback();
}

function initPlayback(): void {
  const ms = new MediaSource();
  mediaSource = ms;
  const audio = new Audio();
  audio.src = URL.createObjectURL(ms);
  audioEl = audio;
  chunkQueue = new OrderedChunkQueue(
    {
      append: chunk => {
        if (!sourceBuffer) throw new Error('sourceBuffer not open yet');
        sourceBuffer.appendBuffer(chunk);
      },
    },
    MAX_CHUNK_QUEUE_SIZE,
    () => sourceBuffer != null,
  );
  ms.addEventListener('sourceopen', () => {
    if (mediaSource !== ms || ms.sourceBuffers.length > 0) return;
    sourceBuffer = ms.addSourceBuffer('audio/mpeg');
    sourceBuffer.addEventListener('updateend', () => {
      if (audioEl && audioEl.paused && sourceBuffer && sourceBuffer.buffered.length > 0) {
        playPromise = audioEl.play().catch(() => {});
      }
      chunkQueue?.notifyAppendEnd();
    });
    // Chunks may have queued up before sourceopen — start feeding now.
    chunkQueue?.pump();
  });
  audio.addEventListener('timeupdate', () => {
    if (!audioEl) return;
    const d = audioEl.duration;
    store().setPlayback({
      currentTime: audioEl.currentTime,
      ...(isFinite(d) ? { duration: d } : {}),
    });
  });
  audio.addEventListener('ended', () => {
    setStatus('done');
    store().setPlayback({ playing: false });
  });
  audio.addEventListener('play', () => store().setPlayback({ playing: true }));
  audio.addEventListener('pause', () => store().setPlayback({ playing: false }));
  setStatus('playing');
}

function finishAudio(): void {
  safeEndOfStream(mediaSource);
  if (audioEl && audioEl.ended) setStatus('done');
  resetPodcastState();
}

// --- script generation (podcast-llm port) --------------------------------------

function requestPodcastMetadata(fullScript: string): void {
  const port = openAIChatPort();
  let result = '';
  port.postMessage({
    type: 'chat',
    messages: [
      { role: 'system', content: getPrompt('podcast.meta', getCurrentLang()) },
      { role: 'user', content: fullScript.slice(0, 4000) },
    ],
    response_format: { type: 'json_object' },
  });
  port.onMessage.addListener((msg: { type: string; content?: string }) => {
    if (msg.type === 'chunk' && msg.content) result += msg.content;
    else if (msg.type === 'done') {
      safePortDisconnect(port);
      if (cancelled) return;
      try {
        const jsonMatch = extractJsonObject(result);
        if (!jsonMatch) return;
        const data = JSON.parse(jsonMatch) as { title?: string; description?: string };
        if (data.title) {
          podcastTitle = data.title.replace(/[/\\:*?"<>|]/g, '_').trim();
          store().updateNowPlaying({ title: data.title, description: data.description });
        }
      } catch (e) {
        console.error('[Podcast] Failed to parse metadata:', e);
      }
    }
  });
}

async function onScriptDone(fullScript: string): Promise<void> {
  let rounds: NlpRound[];
  try {
    rounds = parsePodcastScript(fullScript);
  } catch (e) {
    console.error('[Podcast] Script parsing error:', e);
    setStatus('error', `${t('podcast.scriptParseError')} (${(e as Error).message})`);
    resetPodcastState();
    return;
  }
  podcastTitle = extractPodcastTitle(rounds);
  store().updateNowPlaying({ script: rounds, status: 'generating_audio' });
  store().setRoundTimings([]);
  requestPodcastMetadata(fullScript);
  await generateAudio(rounds);
}

async function generateScript(textContent: string, images: string[] = []): Promise<void> {
  const port = openPodcastLLMPort();
  llmPort = port;
  let fullScript = '';
  const req: PodcastLLMRequest = {
    type: 'generate',
    prompt: getPrompt('podcast.system', getCurrentLang()),
    text: textContent,
  };
  if (images.length > 0) req.images = images;
  port.postMessage(req);
  await new Promise<void>(resolve => {
    resolveScriptPromise = resolve;
    port.onMessage.addListener((msg: ScriptPortMessage) => {
      if (msg.type === 'chunk' && msg.content) {
        fullScript += msg.content;
      } else if (msg.type === 'done') {
        safePortDisconnect(port);
        llmPort = null;
        resolveScriptPromise = null;
        if (!cancelled) void onScriptDone(fullScript);
        resolve();
      } else if (msg.type === 'error') {
        safePortDisconnect(port);
        llmPort = null;
        resolveScriptPromise = null;
        if (!cancelled) {
          setStatus('error', msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.error')));
          resetPodcastState();
        }
        resolve();
      }
    });
    // Fires only when the worker's end goes away — never for our own
    // disconnect() (stopPodcast resolves via resolveScriptPromise instead).
    port.onDisconnect.addListener(() => {
      llmPort = null;
      resolveScriptPromise = null;
      if (cancelled) { resolve(); return; }
      if (isNowPlayingGenerating()) {
        if (!fullScript) {
          setStatus('error', t('podcast.error'));
          resetPodcastState();
        } else {
          // Partial script: salvage whatever rounds parse out of it.
          try {
            const rounds = parsePodcastScript(fullScript);
            podcastTitle = extractPodcastTitle(rounds);
            store().updateNowPlaying({ script: rounds, status: 'generating_audio' });
            store().setRoundTimings([]);
            void generateAudio(rounds);
          } catch {
            setStatus('error', t('podcast.scriptParseError'));
            resetPodcastState();
          }
        }
      }
      resolve();
    });
  });
}

// --- audio generation (podcast-audio port) --------------------------------------

async function generateAudio(rounds: NlpRound[]): Promise<void> {
  if (cancelled) return;
  teardownAudio();
  audioPort = openPodcastAudioPort();
  audioPort.postMessage({
    type: 'generate',
    nlpTexts: rounds.map(r => ({ speaker: r.speaker, text: r.text })),
    audioConfig: { format: 'mp3', sample_rate: 24000, speech_rate: 0 },
  });
  audioPort.onMessage.addListener((msg: AudioPortMessage) => {
    if (!audioPort || cancelled) return;
    if (msg.type === 'audio_chunk' && msg.data) {
      if (!audioEl) initPlayback();
      const bytes = base64ToBytes(msg.data);
      if (!chunkQueue) return;
      // Uint8Array.buffer is ArrayBufferLike to TS; this buffer was freshly
      // allocated above, never a SharedArrayBuffer view.
      const buffer = bytes.buffer as ArrayBuffer;
      chunkQueue.push(buffer);
      audioChunks.push(buffer.slice(0));
      store().setHasAudio(true);
    } else if (msg.type === 'round_end' && msg.audioDuration) {
      const timings = [...store().roundTimings];
      if (msg.startTime != null && msg.endTime != null) {
        timings.push({ startTime: msg.startTime, endTime: msg.endTime });
      } else {
        const prevEnd = timings.length > 0 ? timings[timings.length - 1].endTime : 0;
        timings.push({ startTime: prevEnd, endTime: prevEnd + msg.audioDuration });
      }
      store().setRoundTimings(timings);
    } else if (msg.type === 'done') {
      finishAudio();
    } else if (msg.type === 'error') {
      setStatus('error', msg.errorKey ? t(msg.errorKey) : (msg.error || t('podcast.audioError')));
      resetPodcastState();
    }
  });
  audioPort.onDisconnect.addListener(() => {
    if (cancelled) return;
    if (isNowPlayingGenerating()) {
      if (audioEl && mediaSource) {
        safeEndOfStream(mediaSource);
        resetPodcastState();
      } else {
        setStatus('error', t('podcast.audioError'));
        resetPodcastState();
      }
    }
  });
}

// --- public API (contract — do not change signatures) ---------------------------

/** QuickActions entry point: the full click flow. */
export async function startPodcast(): Promise<void> {
  if (core.getIsGenerating() || core.getIsPodcastGenerating() || isNowPlayingGenerating()) return;
  const originTabId = core.getActiveTabId();
  const originState = originTabId != null ? core.getStateForTab(originTabId) : null;
  if (originTabId == null || !originState) return;

  cancelled = false;
  sessionOriginTabId = originTabId;
  core.setIsPodcastGenerating(true);
  useTabsStore.getState().bump();

  // Claim the single audio resource: any live TTS playback stops first.
  (ttsController as unknown as { stopAllTTS?: () => void }).stopAllTTS?.();

  // Fresh stream: free any previous session's ports/buffers (the previous
  // card disappears with its nowPlaying entry below).
  safePortDisconnect(llmPort);
  llmPort = null;
  teardownAudio();
  store().clearNowPlaying();

  const composer = useComposerStore.getState();
  if (composer.attachmentsTooLarge()) {
    useUIStore.getState().pushToast(t('error.visionPayloadTooLarge'), 'error');
    resetPodcastState();
    return;
  }

  // Selection (if any) becomes the podcast source; pending images ride
  // along as vision material. Always captured from the ORIGIN tab's state
  // — the user may switch tabs while extraction is in flight.
  const selectedText = originState.selectedText;
  const hasSelection = !!(selectedText && selectedText.trim().length > 0);
  const { imageUris } = composer.consumeAttachments();

  // Even with a selection the page must be extracted — a few sentences are
  // not enough material for a 20-25 round dialogue.
  const extractResult = await ensurePageContent(originTabId);
  if (cancelled) return; // stopPodcast already tore everything down
  if (!extractResult.ok) {
    useUIStore.getState().pushToast(extractResult.error.message, 'error');
    resetPodcastState();
    return;
  }

  const textContent = (hasSelection ? selectedText.trim() : originState.pageContent) || '';
  if (!textContent.trim()) {
    useUIStore.getState().pushToast(t('podcast.noContent'), 'error');
    resetPodcastState();
    return;
  }

  const trimmedSelection = hasSelection ? selectedText.trim() : '';
  const sourcePreview = trimmedSelection
    ? trimmedSelection.slice(0, 100) + (trimmedSelection.length > 100 ? '...' : '')
    : '';
  store().setNowPlaying({
    originTabId,
    originTabTitle: originState.pageTitle || '',
    title: '',
    script: [],
    status: 'generating_script',
    sourcePreview,
  });
  await generateScript(textContent, imageUris);
}

/** Full teardown: cancel generation, free audio/script resources, drop the
 *  session (the card and mini-player unmount with it). */
export function stopPodcast(): void {
  cancelled = true;
  safePortDisconnect(llmPort);
  llmPort = null;
  const resolve = resolveScriptPromise;
  resolveScriptPromise = null;
  resolve?.(); // our own disconnect() never fires our onDisconnect
  resetPodcastState();
  sessionOriginTabId = null;
  teardownAudio();
  store().clearNowPlaying();
}

/** Card error-state retry: clean slate, then a fresh click flow. */
export async function retryPodcast(): Promise<void> {
  stopPodcast();
  await startPodcast();
}

/** Toggle playback. Pause is chained behind a pending play() so a rapid
 *  click cannot leave the element playing against the button's state. */
export function handlePlayPause(): void {
  const el = audioEl;
  if (!el) return;
  if (el.paused) {
    playPromise = el.play().catch(() => {});
  } else {
    (playPromise ?? Promise.resolve())
      .then(() => {
        if (audioEl === el && !el.paused) el.pause();
      })
      .catch(() => {});
  }
}

/** Seek to a [0,1] ratio of the buffered stream (progress-bar drag). */
export function seekToRatio(ratio: number): void {
  const el = audioEl;
  if (!el || !el.duration || !isFinite(el.duration)) return;
  const clamped = Math.max(0, Math.min(1, ratio));
  const targetTime = clamped * el.duration;
  const bufferedEnd = sourceBuffer && sourceBuffer.buffered.length > 0
    ? sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1)
    : Infinity;
  el.currentTime = Math.min(targetTime, bufferedEnd);
  store().setPlayback({ currentTime: el.currentTime });
}

/** Replay from the start (kept buffers — free after generation). */
export function replayPodcast(): void {
  const el = audioEl;
  if (!el) return;
  el.currentTime = 0;
  playPromise = el.play().catch(() => {});
  setStatus('playing');
}

/** Download every received chunk as one mp3. */
export function downloadPodcastAudio(): void {
  if (audioChunks.length === 0) return;
  const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  downloadFile(blob, `${podcastTitle || t('podcast.fileName')}-${dateStr}.mp3`, 'audio/mpeg');
}

/**
 * TTS claimed the audio resource while PLAYING: stop like playback ended —
 * pause + status done, but keep the buffered chunks so replay and download
 * stay available. (While GENERATING, the signal handler cancels instead.)
 */
export function stopPodcastAudioForTTS(): void {
  const el = audioEl;
  if (!el || el.paused) return;
  el.pause();
  setStatus('done');
}

// --- TTS mutual exclusion wiring -------------------------------------------------

// The TTS side's claim of the audio resource. Mirroring the legacy
// PODCAST_STOP_REQUEST handler: mid-generation → cancel entirely; playing →
// graceful stop (replay/download survive).
subscribePodcastStop(() => {
  const np = getNowPlaying();
  if (!np) return;
  if (isNowPlayingGenerating()) {
    stopPodcast();
    return;
  }
  stopPodcastAudioForTTS();
});

// Bridge for tts-controller's defensive lookup (`globalThis.__podcastController`):
// registering here means the mutex works end-to-end without either module
// statically importing the other (which would create a cycle).
const g = globalThis as unknown as Record<string, unknown>;
g.__podcastController = { stopPodcast, stopPodcastForTTS };
