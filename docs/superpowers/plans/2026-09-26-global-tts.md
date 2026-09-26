# Window-Global TTS — Implementation Plan

**Date:** 2026-09-26
**Design:** `docs/superpowers/specs/2026-09-26-global-tts-design.md`
**Status:** Completed

## Steps

1. **player.ts** — origin registry (`setTTSOrigin`/`getTTSOrigin`), state
   subscription (`subscribeTTSState`), takeover point at the top of
   `initTTSPlayback`, `detachTTSAnchor`. ✅
2. **downloader.ts** — same origin/detach/reattach pattern for the download
   button. ✅
3. **tts/index.ts** — `detachTTS()` export; `CHAT_RERENDERED` re-attach by
   `[data-msg-id]`; `initTTSPlayback(origin?)` wrapper emits
   `PODCAST_STOP_REQUEST`; `initTTSAutoPlay` binds the msgId; indicator
   wiring. ✅
4. **shell** (`types.ts`, `tab-switch-handler.ts`, `main.ts`) —
   `cleanupActiveFeatures` uses `detachTTS()` (covers tab switch and
   `handleLoadChat`). ✅
5. **dom-helpers.ts** — assistant bubbles from history carry
   `data-msg-id`. ✅
6. **stream-handler.ts** — assistant id hoisted onto the live bubble and
   reused for the history entry; background chunk feeding; background tail
   flush; no unconditional stop on send. ✅
7. **message-sender.ts** — `resendUserMessage` no longer stops TTS. ✅
8. **Indicator** — `ui/tts-indicator.ts`, `#ttsIndicator` in index.html,
   `tts.css`, i18n `tts.reading` / `tts.stop`. ✅
9. **Podcast mutual exclusion** — `EVENTS.PODCAST_STOP_REQUEST`;
   `stopPodcastAudioForTTS` (audio.ts); subscriber in `initPodcast`. ✅
10. **Tests** — extended player/downloader/dom-helpers/stream-handler/
    tab-switch-handler/events tests; new cross-tab, stream-tts,
    tts-indicator, podcast-stop files. ✅
11. **Docs** — spec (above) + AGENTS.md gotcha. ✅

## Verification

- `npx tsc --noEmit` — clean
- `npm run lint` (ESLint + dependency-cruiser) — clean, no cycles
- `npm run test` — 1240 tests / 103 files, all pass (+35 tests)
- `npm run test:coverage` — thresholds met (lines 81.6 / fn 72.1 / branch
  66.4 / stmt 77.0)
- `npm run build` — production build OK
