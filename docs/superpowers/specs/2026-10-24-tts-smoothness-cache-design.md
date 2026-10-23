# TTS Smoothness & Segment Audio Cache

**Date:** 2026-10-24
**Status:** Implemented (plan: `../plans/2026-10-24-tts-smoothness-cache.md`)
**Depends on:** `2026-09-26-global-tts-design.md` (window-global playback — unchanged)

## Problem

Three defects in the current pipeline (`services/tts/player.ts` +
`background/sw-tts.ts`):

1. **Audible gaps between segments.** Synthesis is strictly serial:
   `ttsFlush` refuses to open the port for segment N+1 until segment N's
   `done` arrives. Autoplay cuts every ~2 sentences (~5–10s of audio);
   whenever synthesis is slower than playback the buffer drains and the
   audio stalls at a segment boundary. On a flaky network this happens
   every segment.
2. **Slow start.** First sound waits one full segment round trip. The
   button path sends 5-sentence segments (~300+ chars) before the first
   audio chunk even starts arriving.
3. **Zero caching — pure cost leak.** seed-tts-2.0 bills per Unicode
   character (~¥3 / 10k chars, successful tasks only). A typical 800-char
   answer costs ~¥0.24 per synthesis; reading a 20-message conversation
   costs ~¥5. Replays are the most common TTS action (replay a message,
   play after download, download after play) and today each re-bills
   100%. Worse: autoplay (2-sentence cuts) and the button/download path
   (5-sentence cuts) segment the same text differently, so even a
   per-segment cache would fragment — no boundaries ever match.
4. Minor: a single failed segment stops the whole playback
   (`_fullStopFn` on any error), and long answers grow the SourceBuffer
   unboundedly (memory).

## Goals

- No audible gap between segments on healthy networks; playback never
  drains while synthesis is healthy.
- Instant start on a cache hit; on a miss, first audio after one
  *short* first segment (~60 chars) instead of a 300-char one.
- Synthesize each (text, voice) once: a per-segment audio cache shared
  by play / autoplay / download, LRU-evicted, size-capped, visible and
  clearable in the options page.
- Retry a failed segment once instead of killing the whole playback.
- Stop-early wastes less money: backpressure limits how far ahead of the
  playhead we synthesize.

## Non-goals

- Podcast pipeline (`sw-podcast.ts` / `podcast-direct.ts`) — it can adopt
  the shared cache module later.
- SSML / emotion directives, voice switching, cross-request prosody
  (`section_id`) — noted below as a possible follow-up experiment.
- Persisting playback position across panel reloads.

## Design

### 1. One deterministic, duration-aware segmentation rule (`tts/utils.ts`)

Replace the two ad-hoc splitters (batch `splitToSegments` = 5 sentence
ends; streaming autoplay cut = 2 sentence ends) with a single **greedy
prefix rule**:

- Cut after a sentence end (`SENTENCE_ENDS`) once the accumulated
  segment holds ≥ `FIRST_SEGMENT_CHARS` (60) for the first segment,
  ≥ `SEGMENT_CHARS` (160) afterwards.
- Hard-cut at `MAX_SEGMENT_CHARS` (400) if no sentence end ever arrives.
- The rule only ever looks at the consumed prefix, so applying it
  incrementally (autoplay, text still streaming) and applying it to the
  full text at once (button / download) produce **identical**
  boundaries. This is what makes cache keys stable across all three
  entry paths.

API: one primitive `nextCutEnd(text, from, isFirst)`;
`splitToSegments(text)` = batch application; the streaming path calls
it on the growing buffer. Tests assert streaming cuts === batch cuts.

### 2. Pipelined synthesis engine (`services/tts/engine.ts`)

Extract the synth pipeline from `player.ts`. The engine owns ports,
ordering, backpressure, retries and the cache; the player keeps
MediaSource plumbing, button/origin lifecycle and global state.

- Segment list + head pointer; up to `MAX_INFLIGHT = 2` concurrent `tts`
  ports (the SW router handles every connection independently; each
  SSE request is a separate billed task, concurrency is fine on the
  char-billed 2.0 product).
- **Ordered feed**: only the head segment streams its chunks into the
  SourceBuffer live; non-head segments accumulate into an in-memory
  byte array and append when they become head (MediaSource requires
  strict append order).
- **Backpressure**: don't dispatch another synthesis while
  `bufferedAheadMs() > LOOKAHEAD_MS` (30s); resume on `timeupdate`.
  Also caps cost of stopping early: at most ~30s of unheard audio was
  ever billed.
- **Retry**: on port error / disconnect / `153` for segment i, one
  retry after a 300ms backoff. Second failure → error + full stop
  (current behavior). Failed tasks are not billed by the API.
- **Cache-aware dispatch**: before opening a port, look the segment up
  in the cache; on a hit schedule the cached blob for append (no
  network, zero cost); on a miss synthesize and write the complete
  segment mp3 on `done`.

### 3. Segment audio cache (`services/tts/cache.ts` + IndexedDB v4)

- New store `ttsAudio` in the shared `ai-reader` DB (`db.ts` bumps
  `DB_VERSION` to 4): record `{ key, blob, bytes, createdAt, lastUsedAt }`,
  keyPath `key`, index `lastUsedAt`.
- Key = `sha-256(speaker | resourceId | format | sampleRate | text)`
  (hex, `crypto.subtle`). The text is the exact string sent to the API,
  so given the deterministic segmentation the key is stable across
  sessions and entry paths. A speaker/resource change simply lands in a
  different key namespace; stale entries age out via LRU.
- Value = one complete per-segment mp3 `Blob` (concatenation of that
  request's `352` chunks — each SSE response is a self-contained MP3;
  sequential MP3s in one `audio/mpeg` SourceBuffer is exactly what
  playback already does).
- Eviction: after each write, if total bytes > `TTS_CACHE_CAP`
  (150MB) delete oldest by `lastUsedAt` until under cap − 10%
  hysteresis. The running byte total lives in a `_meta` record so
  writes don't scan the store.
- Corrupt read / quota error → delete the record, treat as a miss.
- `clearTtsCache()` / `estimateTtsCacheBytes()` for the options page.

Player and downloader both obtain audio through the engine, so
download→play and play→download are both free and instant.

### 4. Downloader unification (`tts/downloader.ts`)

Replace the private port/collect plumbing (~80 lines) with engine calls:
await each segment (same 2-parallel cap), concat blobs, download. Same
cache, same retry policy, same segmentation.

### 5. Playback niceties (`player.ts` + `ui/tts-indicator.ts`)

- **Speed control**: a rate button on the global indicator chip cycling
  1.0 → 1.25 → 1.5 → 2.0; sets `audioEl.playbackRate` (plain
  `<audio>`, works over MediaSource). `ttsSpeed` setting persists.
- **Buffer trim**: on `timeupdate`, if `currentTime − bufferedStart >
  60s`, `sourceBuffer.remove(0, currentTime − 10)` — keeps hour-long
  reads flat in memory.
- **Progress**: the indicator shows `m:ss / m:ss` (currentTime vs
  buffered end) while playing.

### 6. Protocol comment cleanup (`shared/protocol.ts`)

`TTSMessage` still documents the raw API event types (`352`/`152`/`153`)
while the SW actually posts `{type:'chunk'|'done'|'error'}`. Fix the
types to match the wire. No behavior change.

## Cost math

At ~¥0.0003/char: an 800-char answer ≈ ¥0.24 per synthesis. With the
cache, the *first* play pays; every replay / download of the same
message in the same voice costs ¥0 and starts instantly (offline).
Backpressure bounds waste on stop-early to ~30s of audio. Retries after
`153` failures don't double-bill (failed tasks aren't billed; a network
abort mid-stream re-synthesizes only that one segment).

## Edge cases

- Stop + immediate replay: in-flight segments are aborted
  (`AbortController` already wired to port disconnect); only completed
  segments were cached, so at most `MAX_INFLIGHT` segments re-bill.
- Autoplay on a streaming answer: the head can't advance past what has
  been segmented yet; generation end flushes the tail as today
  (`ttsFlushRemaining` → `engine.endInput()`).
- Same message, different speaker: different keys — no false hits.
- Hard-cut at 400 chars can split mid-sentence when a text has no
  sentence end at all (rare; preferable to an unbounded request).
- Panel reload still kills playback (accepted in the global-TTS spec);
  cached segments survive, so the replay is instant.

## Possible follow-up (not in scope)

- `section_id` cross-request prosody continuity (seed-tts-2.0 supports
  it) could smooth intonation *across* segment boundaries; needs
  verification that it doesn't break determinism of cached audio.
- Adopt `shared/tts` cache for podcast audio.

## Test plan

- **Segmenter**: streaming cuts === batch cuts over several fixtures
  (CJK, latin, mixed, no-sentence-end 400-char hard cut, first-segment
  smaller budget).
- **Engine**: chunk ordering preserved when two ports resolve out of
  order; backpressure pauses dispatch at 30s lookahead and resumes;
  retry-once then hard-fail; a cache hit never opens a port; `done`
  writes the cache exactly once.
- **Cache**: key stability across calls, LRU eviction under cap,
  `_meta` byte accounting, clear, corrupt-blob fallback.
- **Downloader**: warm cache → zero ports opened; cold → ports opened;
  blob concat + filename unchanged.
- **Player**: rate cycle + persistence, buffer trim call, indicator
  progress formatting; existing player/stream-tts/cross-tab tests
  updated for the new segmentation constants.
