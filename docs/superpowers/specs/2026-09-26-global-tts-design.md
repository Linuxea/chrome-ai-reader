# Window-Global TTS (Cross-Tab Playback)

**Date:** 2026-09-26
**Status:** Implemented

## Problem

TTS playback was page-attached: switching tabs (`shell/tab-switch-handler.ts`
`cleanupActiveFeatures` called `stopTTS()`), loading another chat, or
retrying/editing a message all interrupted the audio. The playback pipeline
itself (port, MediaSource, Audio element, queues in `services/tts/player.ts`)
was already window-global module state — only the interruption points and the
per-message button anchor tied it to one tab.

## Goal

TTS is a **window-global "printer" resource**, mirroring the podcast's
now-playing pattern:

- The only things that stop it: the user (message button or global
  indicator), or the audio resource being claimed (a new TTS playback
  starts — including autoplay on send — or a podcast starts).
- Tab switches, chat loads, retry/edit never interrupt it.
- The origin message's button state is restored when the user returns to the
  origin tab; on all other tabs a persistent indicator chip offers status +
  stop.

## Design

### Origin registry + anchor lifecycle (player.ts / downloader.ts)

- `setTTSOrigin` / `getTTSOrigin`: `{ tabId, msgId }` of the message being
  read. `msgId` is late-bound for autoplay (playback starts before the
  answer bubble exists). Cleared on stop; a new playback resets it.
- `detachTTSAnchor()` — tab switch / chat rebuild drops the button element
  reference (the bubble is about to be discarded); audio and queues keep
  running. `handleLoadChat` goes through the same `cleanupActiveFeatures`
  path, so loading another chat also only detaches.
- `subscribeTTSState(cb)` — start / audio-started / stop notifications,
  driving the global indicator.

### Single takeover point

`initTTSPlayback` starts by fully stopping any running playback (via the
full-stop fn). A new playback claims the resource wherever it starts:
message button, autoplay on send. Consequently the previously scattered
unconditional stops were removed — a plain send / retry / edit with autoplay
off no longer stops TTS. The podcast click keeps stopping TTS directly
(features→services import is legal).

### Re-attach on CHAT_RERENDERED (tts/index.ts)

Assistant bubbles now carry `data-msg-id` — set on the live bubble in
`callAI` (id hoisted before bubble creation and reused for the history
entry) and on restored bubbles in `appendMessageFromHistory`. After a chat
area rebuild, `services/tts` resolves `[data-msg-id="…"] .tts-btn` when the
playback's origin tab is the active tab and restores the
`tts-loading`/`tts-playing` state class; otherwise the stale anchor is
dropped (self-healing after branch switches or deleted messages). The
downloader's button gets the same treatment.

### Background autoplay feeding (stream-handler.ts)

Chunk feeding is no longer gated on `isCurrentTab() && msgEl.isConnected` —
autoplay keeps reading an answer that streams while its tab is hidden. A
background-finished answer flushes its TTS tail (`initTTSAutoPlay(msgEl)`)
and binds the origin msgId before the pending-save early return.

### Global indicator (ui/tts-indicator.ts + index.html + tts.css)

A static `#ttsIndicator` chip next to the podcast mini-player: speaker icon
(waiting → spinner), "Reading aloud" label, stop button. Pure DOM primitive
wired by `services/tts` (ui/** must not import services). i18n keys
`tts.reading` / `tts.stop`.

### Podcast mutual exclusion (PODCAST_STOP_REQUEST)

Starting a TTS playback emits `PODCAST_STOP_REQUEST` (services cannot import
features; mirrors `PODCAST_REBUILD_REQUEST`). The podcast feature subscribes:
mid-generation → `closePodcast()` (cancel entirely); playing →
`stopPodcastAudioForTTS()` (pause, status → done, keep chunks for
replay/download).

## Accepted edges

- Panel reload kills playback (memory-only, same as podcast now-playing).
- Origin tab closed mid-playback: audio completes; re-attach simply never
  matches; the indicator still offers stop.
- The message being read deleted via retry/edit/branch: playback completes
  (printer semantics).
- Autoplay off + send: old playback continues over the new answer.

## Test coverage

`tests/services/tts/player.test.js` (takeover, origin, detach, state
subscription), `tests/services/tts/cross-tab.test.js` (switch keeps playing,
re-attach on origin tab, no re-attach elsewhere, handleLoadChat keeps
playing, PODCAST_STOP_REQUEST emission), `tests/services/tts/stream-tts.test.js`
(bubble id === history id, plain send doesn't stop, autoplay takes over),
`tests/side_panel/ui/tts-indicator.test.js`, `tests/side_panel/features/podcast-stop.test.js`,
`tests/services/tts/downloader.test.js` (download origin + reattach).
