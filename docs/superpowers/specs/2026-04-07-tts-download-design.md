# TTS Download Feature Design

## Overview

Add a download audio button to the side panel. When clicked, it silently generates a complete TTS audio file from the latest AI message and triggers a browser download as MP3.

## UI

- A new button (class `tts-download-btn`) placed next to the existing TTS play button and copy button on the **latest AI message only**.
- Uses a download icon (down-arrow SVG).
- States:
  - **Idle**: download icon, tooltip "Download Audio"
  - **Loading**: spinning animation (reuse `tts-pulse` keyframes), disabled
  - **Success**: brief checkmark flash (1.5s), then revert to idle
  - **Error**: revert to idle
- Button lifecycle: old download buttons are removed when a new AI message arrives, same as TTS play button.

## Data Flow

```
User clicks download button on latest AI message
  -> extract AI message text (prefer .thinking-response-content, fallback to .textContent)
  -> splitToSegments(text) - reuse existing segment splitter
  -> disable button, show loading state
  -> chrome.runtime.connect({ name: 'tts-download' })
  -> send segments sequentially: port.postMessage({ type: 'tts', text: segment })
  -> collect all base64 audio chunks into array
  -> on final 'done' from all segments:
      -> decode all base64 chunks into Uint8Arrays
      -> concatenate into single Blob with type 'audio/mpeg'
      -> create object URL
      -> trigger download via hidden <a download="voice-{timestamp}.mp3">
      -> revoke object URL
      -> restore button to idle
  -> on 'error': show error toast, restore button to idle
```

## Service Worker Changes

Add a new port handler for `'tts-download'` in the `chrome.runtime.onConnect` listener. Reuses existing `callTTS()` function identically.

```js
else if (port.name === 'tts-download') {
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'tts') {
      await callTTS(msg.text, port);
    }
  });
}
```

## Concurrency

Download and playback are completely independent. They use separate ports (`tts-download` vs `tts`) and separate client-side state. The user can play TTS and download simultaneously without conflicts.

## Error Handling

- Missing TTS config: service worker sends `{ type: 'error', errorKey: 'error.noTtsConfig' }` — handled same as play button.
- Network errors: passed through `{ type: 'error', error }` — restore button, show error.
- Double-click protection: button stays disabled during loading; ignore repeat clicks.

## i18n Keys

| Key | zh | en |
|-----|----|----|
| `action.ttsDownload` | 下载语音 | Download Audio |
| `status.ttsDownloading` | 正在生成语音... | Generating audio... |

## Files to Modify

| File | Change |
|------|--------|
| `src/side_panel/services/tts.js` | Add download button creation in `addTTSButton()`, add download handler function, add download state variables |
| `src/background/service-worker.js` | Add `'tts-download'` port handler (5 lines) |
| `src/side_panel/side_panel.css` | Add `.tts-download-btn` styles (reuse `.tts-btn` base styles via comma selector) |
| `src/shared/i18n.js` | Add `action.ttsDownload` and `status.ttsDownloading` translation keys |

## Out of Scope

- Progress percentage during generation
- Custom filename or format selection
- Download from historical (non-latest) AI messages
- WAV/OGG format conversion
