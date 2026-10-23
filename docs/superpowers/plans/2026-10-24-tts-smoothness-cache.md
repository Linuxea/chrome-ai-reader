# TTS Smoothness & Segment Audio Cache — Implementation Plan

**Date:** 2026-10-24
**Design:** `docs/superpowers/specs/2026-10-24-tts-smoothness-cache-design.md`
**Status:** Completed

## Steps

1. **Segmentation** (`services/tts/utils.ts`) — single greedy prefix rule:
   `nextCutEnd(text, from, isFirst)` with `FIRST_SEGMENT_CHARS = 60`,
   `SEGMENT_CHARS = 160`, `MAX_SEGMENT_CHARS = 400`; `splitToSegments`
   is the batch application; `createSegmentStream` is the incremental one
   (strips markdown while the answer streams; tables flattened, fences
   dropped once closed). Tests assert streaming cuts === batch cuts. ✅
2. **DB v4** (`shared/db.ts`) — `ttsAudio` store (keyPath `key`, index
   `lastUsedAt`); `StoreName` extended; create-only upgrade. ✅
3. **Cache module** — landed as `shared/tts-cache.ts` (not `services/tts/`):
   the options page reads/clears it too, and `shared/` is where cross-entry
   modules live (precedent: `chats-db.ts`). `ttsCacheKey` (sha-256,
   deterministic FNV fallback for non-secure contexts), `getCachedSegmentAudio`
   (LRU touch, corrupt → delete + miss), `putSegmentAudio` (+ LRU prune at
   150MB with 10% hysteresis, `_meta__` byte record), `clearTtsCache()`,
   `estimateTtsCacheBytes()`. Voice/audio-param defaults for the key live in
   `shared/tts-params.ts`, shared with `background/sw-tts.ts`. ✅
4. **Engine** (`services/tts/engine.ts`) — extracted from `player.ts`:
   segment queue + head pointer, `MAX_INFLIGHT = 2` concurrent ports
   (downloader now uses the `tts` port — the SW routed `tts-download` to the
   same handler anyway), ordered append (head streams live, others buffer),
   30s `lookaheadMs` backpressure re-checked on `notifyProgress`, retry-once
   (300ms; only before any byte streamed — TTS output is not reproducible),
   cache-aware dispatch. ✅
5. **Player** (`services/tts/player.ts`) — consumes the engine; keeps
   MediaSource, anchors, origin registry, indicator state. `ttsEnqueue` takes
   final (pre-stripped) text; `ttsAppendChunk` feeds the segment stream;
   `ttsFlushRemaining`/`ttsFinishInput` end input. `onDrained` → endOfStream
   (only after input ended — fixes the old early-endOfStream drop on
   autoplay), empty playback stops cleanly instead of zombie-loading. ✅
6. **Downloader** (`services/tts/downloader.ts`) — engine-based: collects
   ordered chunks, one Blob, download; same cache (download⇄play free);
   button path prefers `dataset.markdown` (same source autoplay streamed →
   same cache keys). ✅
7. **Playback niceties** — `ttsSpeed` setting (`platform/settings.ts`),
   rate button on the global indicator cycling 1.0/1.25/1.5/2.0
   (`TTS_SPEED_STEPS`), progress `m:ss / m:ss` vs buffered end
   (`subscribeTTSProgress`), SourceBuffer trim 60s behind the playhead. ✅
8. **Options** (`options/tts-settings.ts` + `options/index.html`) — cache
   usage row (`formatBytes`), clear button with feedback. ✅
9. **Protocol cleanup** (`shared/protocol.ts`) — `TTSMessage` now documents
   the actual `{chunk|done|error}` wire format; 352/152/153 stay documented
   as the upstream API events. ✅
10. **Tests** — new `tests/services/tts/engine.test.js` (ordering under
    out-of-order completion, backpressure, retry-then-succeed, no-retry
    after streamed bytes, duplicate-done idempotence, cache-hit-no-port,
    abort), `tests/shared/tts-cache.test.js` (key stability, round-trip,
    corrupt fallback, byte accounting, LRU prune, clear); rewritten
    `utils.test.js` (budgets, hard cut, streaming===batch fixtures, table
    stripping) and `downloader.test.js` (pipelined two-segment order,
    warm-cache zero ports, markdown-source preference); extended
    `player.test.js` (rate, progress, engine wiring) and
    `tts-indicator.test.js` (rate/progress). ✅
11. **Docs** — spec (above), this plan, AGENTS.md gotchas (engine pipeline,
    segmentation determinism, cache store). ✅
12. **First-play jump hotfix #1 (MSE mitigations — superseded)** — reported
    after first dogfood: cold playback skipped to segment 2 when segment 2
    finished synthesizing. Added a 2.5s start cushion, `mode='sequence'`,
    ≤32KB sliced appends. Masked, did not cure. ✅ (superseded by step 13)
13. **First-play jump fix #2 (WebAudio sink)** — the jump recurred; root
    cause is concatenating separately-encoded mp3s into one MSE timeline.
    The player is now a WebAudio sink: per-segment `decodeAudioData` +
    sample-accurate `AudioBufferSourceNode` scheduling, rate-change
    reschedule, `_decoding` guard in `maybeFinished`, played-buffer pruning.
    Engine output contract simplified to `onSegmentAudio(bytes)` (ordered
    full-segment delivery; retry-once unconditionally safe; empty segments
    skipped). See spec §7. ✅

## Verification

- `npx tsc --noEmit` — clean
- `npm run lint` — ESLint + dependency-cruiser clean (136 modules)
- `npm run test` — 1215 tests / 99 files, all pass (+24 net vs the rewritten
  suites)
- `npm run test:coverage` — lines 82.3 / fn 72.9 / branch 67.6 / stmts 77.6,
  thresholds met
- `npm run build` — production build OK
