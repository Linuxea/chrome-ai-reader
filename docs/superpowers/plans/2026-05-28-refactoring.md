# Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix architecture violations, reduce code duplication, improve maintainability, and add type safety to the event bus across 6 incremental phases.

**Architecture:** Each phase is a separate branch/PR. The `init*()` singleton pattern is preserved. Changes are backwards-compatible within each phase — existing tests must pass after each task.

**Tech Stack:** TypeScript (strict mode), Chrome Extension APIs, Vitest, Vite + Rollup IIFE

---

## Phase 1: Shared Utilities & Type Foundation

### Task 1: Create `toErrorMessage` utility

**Files:**
- Create: `src/shared/utils.ts`
- Create: `tests/shared/utils.test.js`

- [ ] **Step 1: Write the test**

```javascript
// tests/shared/utils.test.js
import { describe, it, expect } from 'vitest';
import { toErrorMessage } from '../../src/shared/utils.ts';

describe('toErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(toErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('returns string as-is', () => {
    expect(toErrorMessage('string error')).toBe('string error');
  });

  it('converts number to string', () => {
    expect(toErrorMessage(42)).toBe('42');
  });

  it('converts object to string', () => {
    expect(toErrorMessage({ code: 500 })).toBe('[object Object]');
  });

  it('returns "Unknown error" for null', () => {
    expect(toErrorMessage(null)).toBe('Unknown error');
  });

  it('returns "Unknown error" for undefined', () => {
    expect(toErrorMessage(undefined)).toBe('Unknown error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/utils.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/shared/utils.ts
/**
 * Safely extract an error message from any caught value.
 * Replaces the repeated `(e as Error).message` pattern across the codebase.
 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e !== null && e !== undefined) return String(e);
  return 'Unknown error';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/utils.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/utils.ts tests/shared/utils.test.js
git commit -m "refactor: add toErrorMessage utility for consistent error handling"
```

---

### Task 2: Create Chrome API helpers

**Files:**
- Create: `src/shared/chrome-helpers.ts`
- Create: `tests/shared/chrome-helpers.test.js`

- [ ] **Step 1: Write the test**

```javascript
// tests/shared/chrome-helpers.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safePortDisconnect, safeEndOfStream } from '../../src/shared/chrome-helpers.ts';

describe('safePortDisconnect', () => {
  it('calls disconnect on valid port', () => {
    const port = { disconnect: vi.fn() };
    safePortDisconnect(port);
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('does not throw when disconnect throws', () => {
    const port = { disconnect: vi.fn(() => { throw new Error('Already disconnected'); }) };
    expect(() => safePortDisconnect(port)).not.toThrow();
  });

  it('does not throw for null port', () => {
    expect(() => safePortDisconnect(null)).not.toThrow();
  });
});

describe('safeEndOfStream', () => {
  it('calls endOfStream when readyState is open', () => {
    const ms = { readyState: 'open', endOfStream: vi.fn() };
    safeEndOfStream(ms);
    expect(ms.endOfStream).toHaveBeenCalled();
  });

  it('does not call endOfStream when readyState is not open', () => {
    const ms = { readyState: 'closed', endOfStream: vi.fn() };
    safeEndOfStream(ms);
    expect(ms.endOfStream).not.toHaveBeenCalled();
  });

  it('does not throw when endOfStream throws', () => {
    const ms = { readyState: 'open', endOfStream: vi.fn(() => { throw new Error('network error'); }) };
    expect(() => safeEndOfStream(ms)).not.toThrow();
  });

  it('does not throw for null', () => {
    expect(() => safeEndOfStream(null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/chrome-helpers.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/shared/chrome-helpers.ts
/**
 * Safely disconnect a Chrome port, ignoring AlreadyClosed errors.
 * Used by TTS player, podcast audio, and downloader modules.
 */
export function safePortDisconnect(port: chrome.runtime.Port | null): void {
  if (!port) return;
  try { port.disconnect(); } catch { /* port may already be disconnected */ }
}

/**
 * Safely end a MediaSource stream if it's in the 'open' state.
 * Used by TTS player and podcast audio modules.
 */
export function safeEndOfStream(ms: MediaSource | null): void {
  if (!ms || ms.readyState !== 'open') return;
  try { ms.endOfStream(); } catch { /* network error or invalid state */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/chrome-helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/chrome-helpers.ts tests/shared/chrome-helpers.test.js
git commit -m "refactor: add safePortDisconnect and safeEndOfStream Chrome API helpers"
```

---

### Task 3: Create CSS selector constants

**Files:**
- Create: `src/shared/css-selectors.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/shared/css-selectors.ts
/**
 * Centralized CSS class selectors used across the codebase.
 * Changing a class name here updates all references automatically.
 */
export const CSS = {
  // Message elements
  MESSAGE: '.message',
  MESSAGE_USER: '.message-user',
  MESSAGE_AI: '.message-ai',
  MESSAGE_ERROR: '.message-error',

  // TTS
  TTS_BTN: '.tts-btn',
  TTS_PLAYING: '.tts-playing',
  TTS_LOADING: '.tts-loading',
  TTS_DOWNLOAD_BTN: '.tts-download-btn',

  // Image/OCR
  IMAGE_PREVIEW_ITEM: '.image-preview-item',
  IMAGE_PREVIEW_ERROR: '.image-preview-item.error',
  IMAGE_STATUS: '.image-status',
  IMAGE_THUMB: '.image-thumb',

  // Outline
  OUTLINE_CONTAINER: '.outline-container',
  OUTLINE_NODE: '.outline-node',

  // Podcast
  PODCAST_CARD: '.podcast-card',
  PODCAST_PLAY_BTN: '.podcast-play-btn',

  // Chart
  CHART_CARD: '.chart-card',

  // Common
  WELCOME_MSG: '.welcome-msg',
  THINKING_CONTENT: '.thinking-response-content',
  SUGGEST_QUESTIONS: '.suggest-questions',
  AI_ACTION_BTN: '.ai-action-btn',
} as const;
```

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/css-selectors.ts
git commit -m "refactor: add centralized CSS selector constants"
```

---

### Task 4: Add date formatting utilities

**Files:**
- Modify: `src/shared/format.ts`
- Modify: `tests/shared/format.test.js`

- [ ] **Step 1: Write the tests**

Add to `tests/shared/format.test.js`:

```javascript
describe('formatDateTime', () => {
  it('formats date as YYYY-MM-DD HH:MM', () => {
    const date = new Date(2026, 0, 15, 10, 30); // Jan 15, 2026 10:30
    const result = formatDateTime(date);
    expect(result).toBe('2026-01-15 10:30');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2026, 2, 5, 8, 5); // Mar 5, 2026 08:05
    const result = formatDateTime(date);
    expect(result).toBe('2026-03-05 08:05');
  });
});

describe('formatDateOnly', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2026, 0, 15);
    const result = formatDateOnly(date);
    expect(result).toBe('2026-01-15');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2026, 2, 5);
    const result = formatDateOnly(date);
    expect(result).toBe('2026-03-05');
  });
});
```

- [ ] **Step 2: Add imports to test file**

Update the import line in `tests/shared/format.test.js`:

```javascript
import { formatDuration, formatDate, formatDateTime, formatDateOnly } from '../../src/shared/format.js';
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/shared/format.test.js`
Expected: FAIL — `formatDateTime` and `formatDateOnly` not exported

- [ ] **Step 4: Write implementation**

Add to `src/shared/format.ts`:

```typescript
/**
 * Format a Date as "YYYY-MM-DD HH:MM".
 * Used by chat history export and outline export.
 */
export function formatDateTime(date: Date): string {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0') + ' ' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
}

/**
 * Format a Date as "YYYY-MM-DD".
 * Used by file download naming.
 */
export function formatDateOnly(date: Date): string {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/shared/format.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/format.ts tests/shared/format.test.js
git commit -m "refactor: add formatDateTime and formatDateOnly utilities"
```

---

### Task 5: Type the event bus

**Files:**
- Modify: `src/side_panel/events.ts`

- [ ] **Step 1: Write the typed event bus**

Replace the contents of `src/side_panel/events.ts`:

```typescript
import type { ChatMessage } from '../shared/types';

type EventHandler = (...args: unknown[]) => void;

export const EVENTS = {
  RETRY: 'retry',
  REMOVE_SUGGEST_QUESTIONS: 'removeSuggestQuestions',
  REQUEST_RERENDER: 'requestRerender',
  GENERATE_SUGGESTIONS: 'generateSuggestions',
  GENERATE_OUTLINE: 'generateOutline',
  CLEAR_QUOTE_PREVIEW: 'clearQuotePreview',
  CHART_CLICK: 'chartClick',
  PODCAST_CLICK: 'podcastClick',
  ADD_TTS_BUTTON: 'addTTSButton',
  SAVE_CURRENT_CHAT: 'saveCurrentChat',
  RENDER_HISTORY_LIST: 'renderHistoryList',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Typed event map — maps event names to their handler signatures */
interface EventMap {
  [EVENTS.RETRY]: (args: { wrapper: HTMLElement; rawText: string; rawDisplay: string; rawQuote?: string }) => void;
  [EVENTS.REMOVE_SUGGEST_QUESTIONS]: () => void;
  [EVENTS.REQUEST_RERENDER]: () => void;
  [EVENTS.GENERATE_SUGGESTIONS]: (args: { msgEl: HTMLElement; history: ChatMessage[] }) => void;
  [EVENTS.GENERATE_OUTLINE]: () => void;
  [EVENTS.CLEAR_QUOTE_PREVIEW]: () => void;
  [EVENTS.CHART_CLICK]: () => void;
  [EVENTS.PODCAST_CLICK]: () => void;
  [EVENTS.ADD_TTS_BUTTON]: (args: { msgEl: HTMLElement }) => void;
  [EVENTS.SAVE_CURRENT_CHAT]: () => void;
  [EVENTS.RENDER_HISTORY_LIST]: () => void;
}

const handlers = new Map<string, Set<EventHandler>>();

export function on<K extends EventName>(event: K, handler: EventMap[K]): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler as EventHandler);
  return () => handlers.get(event)?.delete(handler as EventHandler);
}

export function off(event: EventName, handler: EventMap[EventName]): void {
  handlers.get(event)?.delete(handler as EventHandler);
}

export function emit<K extends EventName>(event: K, ...args: Parameters<EventMap[K]>): void {
  handlers.get(event)?.forEach(fn => fn(...args));
}
```

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS (may show warnings in files that use `emit` with wrong types — those are fixed in later tasks)

- [ ] **Step 3: Run existing event tests**

Run: `npx vitest run tests/side_panel/events.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/events.ts
git commit -m "refactor: add typed event bus with EventMap interface"
```

---

### Task 6: Add OCR validation guard

**Files:**
- Modify: `src/side_panel/services/ocr.ts`
- Modify: `src/side_panel/services/message-sender.ts`
- Modify: `src/side_panel/services/quick-action-handler.ts`

- [ ] **Step 1: Add `validateImageState` to `ocr.ts`**

Add at the end of `src/side_panel/services/ocr.ts` (before the closing newline):

```typescript
/**
 * Validate that OCR state allows sending a message.
 * Returns null if OK, or an error message string if validation fails.
 */
export function validateImageState(): string | null {
  if (state.getOcrRunning() > 0) return t('error.ocrRunning');
  if (hasImageErrors()) {
    const firstError = document.querySelector('.image-preview-item.error');
    const reason = firstError?.getAttribute('title') || '';
    return t('error.ocrPartialFail') + (reason ? `：${reason}` : '');
  }
  return null;
}
```

- [ ] **Step 2: Update `message-sender.ts` to use guard**

In `src/side_panel/services/message-sender.ts`, update the import line:

```typescript
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews, validateImageState } from './ocr.js';
```

Replace the validation block in `sendMessage()` (lines 119-129):

```typescript
  const imageError = validateImageState();
  if (imageError) {
    appendMessage('error', imageError);
    return;
  }
```

- [ ] **Step 3: Update `quick-action-handler.ts` to use guard**

In `src/side_panel/services/quick-action-handler.ts`, update the import line:

```typescript
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews, validateImageState } from './ocr.js';
```

Replace the validation block in `handleQuickAction()` (lines 33-43):

```typescript
  const imageError = validateImageState();
  if (imageError) {
    appendMessage('error', imageError);
    return;
  }
```

- [ ] **Step 4: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/services/quick-action-handler.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/side_panel/services/ocr.ts src/side_panel/services/message-sender.ts src/side_panel/services/quick-action-handler.ts
git commit -m "refactor: extract validateImageState guard to eliminate OCR validation duplication"
```

---

### Task 7: Update consumers to use `toErrorMessage`

**Files:**
- Modify: `src/side_panel/services/stream-handler.ts`
- Modify: `src/side_panel/services/message-sender.ts`
- Modify: `src/side_panel/features/outline.ts`
- Modify: `src/side_panel/services/chart-extract.ts`
- Modify: `src/side_panel/features/podcast/script.ts`
- (and others with `(e as Error).message` pattern)

- [ ] **Step 1: Update `stream-handler.ts`**

Add import at top:
```typescript
import { toErrorMessage } from '../../shared/utils';
```

Replace `(e as Error).message` occurrences. Note: `stream-handler.ts` doesn't have explicit try/catch — verify and update only files that have the pattern.

- [ ] **Step 2: Update `message-sender.ts`**

Add import:
```typescript
import { toErrorMessage } from '../../shared/utils';
```

Replace line 98:
```typescript
    const err = e as Error;
```
with:
```typescript
    const errMsg = toErrorMessage(e);
```

And update line 101:
```typescript
      appendMessage('error', errMsg);
```

- [ ] **Step 3: Update `outline.ts`**

Add import:
```typescript
import { toErrorMessage } from '../../shared/utils';
```

No `(e as Error).message` pattern found in this file — skip if not present.

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/side_panel/services/message-sender.ts src/side_panel/services/stream-handler.ts
git commit -m "refactor: use toErrorMessage utility in error handlers"
```

---

### Task 8: Update TTS/Podcast to use Chrome helpers

**Files:**
- Modify: `src/side_panel/services/tts/player.ts`
- Modify: `src/side_panel/features/podcast/audio.ts`
- Modify: `src/side_panel/services/tts/downloader.ts`

- [ ] **Step 1: Update `tts/player.ts`**

Add import:
```typescript
import { safePortDisconnect, safeEndOfStream } from '../../../shared/chrome-helpers';
```

Replace port disconnect pattern (line 56-58):
```typescript
  if (ttsPort) {
    try { ttsPort.disconnect(); } catch { /* cleanup */ }
    ttsPort = null;
  }
```
with:
```typescript
  safePortDisconnect(ttsPort);
  ttsPort = null;
```

Replace MediaSource endOfStream pattern (line 51):
```typescript
    try { if (ttsMediaSource.readyState === 'open') ttsMediaSource.endOfStream(); } catch { /* cleanup */ }
```
with:
```typescript
    safeEndOfStream(ttsMediaSource);
```

Also update `ttsFlush()` (line 124) and `ttsFlushRemaining()` (lines 229-231) to use `safePortDisconnect` and `safeEndOfStream`.

- [ ] **Step 2: Update `podcast/audio.ts`**

Add import:
```typescript
import { safePortDisconnect, safeEndOfStream } from '../../../shared/chrome-helpers';
```

Replace cleanup patterns in `cleanupPodcastAudio()` (lines 31-33) and `initPodcastPlayback()` (lines 38-40) with `safePortDisconnect()` and `safeEndOfStream()`.

- [ ] **Step 3: Update `tts/downloader.ts`**

Add import and replace port disconnect pattern.

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/side_panel/services/tts/player.ts src/side_panel/features/podcast/audio.ts src/side_panel/services/tts/downloader.ts
git commit -m "refactor: use safePortDisconnect and safeEndOfStream Chrome helpers"
```

---

### Task 9: Replace hard-coded CSS selectors with constants

**Files:**
- Modify: `src/side_panel/services/tts/index.ts`
- Modify: `src/side_panel/services/ocr.ts`
- Modify: `src/side_panel/services/stream-handler.ts`
- Modify: `src/side_panel/ui/dom-helpers.ts`

- [ ] **Step 1: Update `tts/index.ts`**

Add import:
```typescript
import { CSS } from '../../../shared/css-selectors';
```

Replace string literals:
- `'.tts-btn'` → `CSS.TTS_BTN`
- `'.tts-playing'` → `CSS.TTS_PLAYING`
- `'.tts-loading'` → `CSS.TTS_LOADING`
- `'.tts-download-btn'` → `CSS.TTS_DOWNLOAD_BTN`
- `'.ai-action-btn'` → `CSS.AI_ACTION_BTN`

- [ ] **Step 2: Update `ocr.ts`**

Add import:
```typescript
import { CSS } from '../../shared/css-selectors';
```

Replace:
- `'.image-preview-item.error'` → `CSS.IMAGE_PREVIEW_ERROR`
- `'.image-preview-item'` → `CSS.IMAGE_PREVIEW_ITEM`
- `'.image-status'` → `CSS.IMAGE_STATUS`
- `'.image-thumb'` → `CSS.IMAGE_THUMB`

- [ ] **Step 3: Update `dom-helpers.ts`**

Add import:
```typescript
import { CSS } from '../../shared/css-selectors';
```

Replace:
- `'.welcome-msg'` → `CSS.WELCOME_MSG`
- `'.message'` → `CSS.MESSAGE`

- [ ] **Step 4: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/services/tts/index.ts src/side_panel/services/ocr.ts src/side_panel/services/stream-handler.ts src/side_panel/ui/dom-helpers.ts
git commit -m "refactor: replace hard-coded CSS selectors with centralized constants"
```

---

## Phase 2: Extract Shared Audio Stream Player

### Task 10: Create shared audio stream module

**Files:**
- Create: `src/shared/audio-stream.ts`
- Create: `tests/shared/audio-stream.test.js`

- [ ] **Step 1: Write the test**

```javascript
// tests/shared/audio-stream.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Audio and MediaSource
class MockSourceBuffer {
  appendBuffer = vi.fn();
  removeEventListener = vi.fn();
  addEventListener = vi.fn((event, cb) => {
    if (event === 'updateend') this._updateendCb = cb;
  });
  _updateendCb = null;
  triggerUpdateend() { if (this._updateendCb) this._updateendCb(); }
  buffered = { length: 0, end: vi.fn(() => 0) };
}

class MockMediaSource {
  readyState = 'open';
  sourceBuffers = [];
  addSourceBuffer = vi.fn(() => {
    const sb = new MockSourceBuffer();
    this.sourceBuffers.push(sb);
    return sb;
  });
  endOfStream = vi.fn();
  addEventListener = vi.fn();
}

globalThis.MediaSource = MockMediaSource;
globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
globalThis.Audio = vi.fn(() => ({
  src: '',
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  paused: true,
  addEventListener: vi.fn(),
}));

import { createAudioStream } from '../../src/shared/audio-stream.ts';

describe('createAudioStream', () => {
  it('creates an audio stream handle', () => {
    const handle = createAudioStream({ mimeType: 'audio/mpeg' });
    expect(handle).toBeDefined();
    expect(handle.appendChunk).toBeInstanceOf(Function);
    expect(handle.finish).toBeInstanceOf(Function);
    expect(handle.destroy).toBeInstanceOf(Function);
  });

  it('destroy cleans up audio element', () => {
    const handle = createAudioStream({ mimeType: 'audio/mpeg' });
    const audioEl = handle.audioEl;
    handle.destroy();
    expect(audioEl.pause).toHaveBeenCalled();
    expect(audioEl.src).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/audio-stream.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/shared/audio-stream.ts
/**
 * Shared MediaSource + SourceBuffer streaming audio player.
 * Used by both TTS player and podcast audio to avoid duplicating
 * ~80 lines of MediaSource setup, chunk buffering, and cleanup logic.
 */

interface AudioStreamOptions {
  mimeType?: string;
  onFirstChunkPlayed?: () => void;
  onEnded?: () => void;
}

export interface AudioStreamHandle {
  /** Append a base64-encoded audio chunk */
  appendChunk(base64Data: string): void;
  /** Signal that all chunks have been sent — ends the stream */
  finish(): void;
  /** Clean up all resources */
  destroy(): void;
  /** The underlying audio element */
  audioEl: HTMLAudioElement;
}

export function createAudioStream(options: AudioStreamOptions = {}): AudioStreamHandle {
  const mimeType = options.mimeType || 'audio/mpeg';

  let chunkQueue: ArrayBuffer[] = [];
  let bufferAppending = false;
  let destroyed = false;

  const ms = new MediaSource();
  const audio = new Audio();
  audio.src = URL.createObjectURL(ms);

  let sourceBuffer: SourceBuffer | null = null;
  let started = false;

  ms.addEventListener('sourceopen', () => {
    if (destroyed || ms.sourceBuffers.length > 0) return;
    sourceBuffer = ms.addSourceBuffer(mimeType);

    sourceBuffer.addEventListener('updateend', () => {
      bufferAppending = false;
      if (destroyed) return;

      if (!started && audio.paused && sourceBuffer!.buffered.length > 0) {
        started = true;
        audio.play().then(() => {
          options.onFirstChunkPlayed?.();
        }).catch(() => {});
      }
      appendNext();
    });
  });

  audio.addEventListener('ended', () => {
    options.onEnded?.();
  });

  function appendNext(): void {
    if (!sourceBuffer || bufferAppending || chunkQueue.length === 0) return;
    bufferAppending = true;
    const chunk = chunkQueue.shift()!;
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (e) {
      console.error('[AudioStream] appendBuffer error:', e);
      bufferAppending = false;
    }
  }

  function decodeBase64(base64Data: string): ArrayBuffer {
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes.buffer;
  }

  return {
    audioEl: audio,

    appendChunk(base64Data: string): void {
      if (destroyed) return;
      chunkQueue.push(decodeBase64(base64Data));
      appendNext();
    },

    finish(): void {
      if (destroyed) return;
      const finishStream = () => {
        if (sourceBuffer && !bufferAppending) {
          try { safeEndOfStream(ms); } catch { /* cleanup */ }
        }
      };
      if (bufferAppending) {
        const handler = () => { finishStream(); sourceBuffer?.removeEventListener('updateend', handler); };
        sourceBuffer?.addEventListener('updateend', handler);
      } else {
        finishStream();
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      audio.pause();
      audio.src = '';
      try { safeEndOfStream(ms); } catch { /* cleanup */ }
      chunkQueue = [];
      sourceBuffer = null;
    },
  };
}

// Inline safeEndOfStream to avoid circular dependency with chrome-helpers
function safeEndOfStream(ms: MediaSource): void {
  if (ms.readyState === 'open') {
    try { ms.endOfStream(); } catch { /* network error or invalid state */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/audio-stream.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/audio-stream.ts tests/shared/audio-stream.test.js
git commit -m "refactor: add shared AudioStreamPlayer for MediaSource streaming"
```

---

### Task 11: Refactor TTS player to use shared audio stream

**Files:**
- Modify: `src/side_panel/services/tts/player.ts`

- [ ] **Step 1: Refactor `initTTSPlayback`**

Replace the inline MediaSource setup in `initTTSPlayback()` with `createAudioStream()`. Keep the sentence queue and TTS-specific logic.

Key changes:
- Import `createAudioStream` from `../../../shared/audio-stream`
- Remove `ttsMediaSource`, `ttsSourceBuffer`, `ttsAudioEl`, `ttsChunkQueue`, `ttsBufferAppending` variables
- Replace with a single `let _stream: AudioStreamHandle | null = null`
- `initTTSPlayback()` creates the stream
- `ttsFlush()` uses `_stream.appendChunk()` after decoding
- `stopTTSPlayback()` calls `_stream.destroy()`
- `ttsFlushRemaining()` uses `_stream.finish()`

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run TTS tests**

Run: `npx vitest run tests/services/tts/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/services/tts/player.ts
git commit -m "refactor: TTS player uses shared AudioStreamPlayer"
```

---

### Task 12: Refactor podcast audio to use shared audio stream

**Files:**
- Modify: `src/side_panel/features/podcast/audio.ts`

- [ ] **Step 1: Refactor `initPodcastPlayback`**

Replace the inline MediaSource setup with `createAudioStream()`. Keep podcast-specific logic (round timings, seek, download, transcript highlighting).

Key changes:
- Import `createAudioStream` from `../../../shared/audio-stream`
- Remove `podcastMediaSource`, `podcastSourceBuffer`, `podcastAudioEl`, `podcastChunkQueue`, `podcastBufferAppending` variables
- Replace with `let _stream: AudioStreamHandle | null = null`
- `initPodcastPlayback()` creates the stream with `onFirstChunkPlayed` and `onEnded` callbacks
- `generatePodcastAudio()` uses `_stream.appendChunk()`
- `cleanupPodcastAudio()` calls `_stream.destroy()`
- Seek functions use `_stream.audioEl`

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run podcast tests**

Run: `npx vitest run tests/side_panel/features/podcast/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/features/podcast/audio.ts
git commit -m "refactor: podcast audio uses shared AudioStreamPlayer"
```

---

## Phase 3: Fix Layer Violations

### Task 13: Extract TTS button creation to UI layer

**Files:**
- Create: `src/side_panel/ui/tts-buttons.ts`
- Modify: `src/side_panel/services/tts/index.ts`

- [ ] **Step 1: Create `tts-buttons.ts`**

```typescript
// src/side_panel/ui/tts-buttons.ts
import { t } from '../../shared/i18n.js';
import { CSS } from '../../shared/css-selectors';

interface TTSButtonDeps {
  onToggleTTS: (msgEl: HTMLElement) => void;
  onDownload: (msgEl: HTMLElement) => void;
}

/**
 * Create copy, TTS, and download buttons for an AI message.
 * Pure UI construction — delegates behavior to callbacks.
 */
export function createTTSButtons(msgEl: HTMLElement, deps: TTSButtonDeps): void {
  // Remove existing buttons
  const prevTts = msgEl.querySelector(CSS.TTS_BTN);
  if (prevTts) prevTts.remove();
  const prevDownload = msgEl.querySelector(CSS.TTS_DOWNLOAD_BTN);
  if (prevDownload) prevDownload.remove();
  const prevCopy = msgEl.querySelector(CSS.AI_ACTION_BTN);
  if (prevCopy) prevCopy.remove();

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = CSS.AI_ACTION_BTN.replace('.', '');
  copyBtn.title = t('action.copy');
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  copyBtn.addEventListener('click', () => {
    const contentEl = msgEl.querySelector(CSS.THINKING_CONTENT);
    const text = contentEl ? contentEl.textContent : msgEl.textContent;
    if (text && text.trim()) {
      navigator.clipboard.writeText(text.trim()).then(() => {
        copyBtn.title = t('action.copied');
        setTimeout(() => { copyBtn.title = t('action.copy'); }, 1500);
      });
    }
  });
  msgEl.appendChild(copyBtn);

  // TTS button
  const btn = document.createElement('button');
  btn.className = CSS.TTS_BTN.replace('.', '');
  btn.title = t('action.tts');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
  btn.addEventListener('click', () => deps.onToggleTTS(msgEl));
  msgEl.appendChild(btn);

  // Download button
  const dlBtn = document.createElement('button');
  dlBtn.className = CSS.TTS_DOWNLOAD_BTN.replace('.', '');
  dlBtn.title = t('action.ttsDownload');
  dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
  dlBtn.addEventListener('click', () => deps.onDownload(msgEl));
  msgEl.appendChild(dlBtn);
}
```

- [ ] **Step 2: Update `tts/index.ts`**

Replace the `addTTSButton()` function body with a delegation to `createTTSButtons()`:

```typescript
import { createTTSButtons } from '../../ui/tts-buttons';

export function addTTSButton(msgEl: HTMLElement): void {
  createTTSButtons(msgEl, {
    onToggleTTS: handleTTSButtonClick,
    onDownload: handleTTSDownloadClick,
  });
}
```

- [ ] **Step 3: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/ui/tts-buttons.ts src/side_panel/services/tts/index.ts
git commit -m "refactor: move TTS button creation from service to UI layer"
```

---

### Task 14: Split OCR module into service and UI

**Files:**
- Create: `src/side_panel/ui/ocr-preview.ts`
- Modify: `src/side_panel/services/ocr.ts`

- [ ] **Step 1: Create `ocr-preview.ts`**

Move the following from `ocr.ts` to `ui/ocr-preview.ts`:
- `_imageUploadBtn`, `_imageFileInput`, `_imagePreviewBar` variables
- `initOCR()` — the event binding part
- `addImagePreview()` — DOM creation
- `collectImageDataUris()` — DOM querying
- `clearImagePreviews()` — DOM clearing
- `hasImageErrors()` — DOM querying

Keep in `ocr.ts`:
- `runOCR()` — API call
- `buildOcrContext()` — pure data transformation
- `extractOcrText()` — pure data transformation
- `validateImageState()` — validation
- `getOcrRunning()` — state accessor

- [ ] **Step 2: Update imports in consumers**

Files that import from `ocr.ts`:
- `message-sender.ts` — imports `hasImageErrors`, `buildOcrContext`, `collectImageDataUris`, `clearImagePreviews`, `validateImageState`
- `quick-action-handler.ts` — imports same set
- `ui/global-events.ts` — imports `clearImagePreviews`
- `ui/tab-switch-handler.ts` — imports `clearImagePreviews`

Update imports to split between `services/ocr.ts` and `ui/ocr-preview.ts`:
- `buildOcrContext`, `validateImageState`, `getOcrRunning` → `services/ocr.ts`
- `hasImageErrors`, `collectImageDataUris`, `clearImagePreviews` → `ui/ocr-preview.ts`
- `initOCR`, `addImagePreview` → `ui/ocr-preview.ts`

- [ ] **Step 3: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/ui/ocr-preview.ts src/side_panel/services/ocr.ts
git commit -m "refactor: split OCR module into service (API) and UI (preview) layers"
```

---

### Task 15: Extract thinking block rendering from stream-handler

**Files:**
- Modify: `src/side_panel/ui/dom-helpers.ts`
- Modify: `src/side_panel/services/stream-handler.ts`

- [ ] **Step 1: Add thinking block helpers to `dom-helpers.ts`**

Add to `src/side_panel/ui/dom-helpers.ts`:

```typescript
export interface ThinkingElements {
  details: HTMLDetailsElement;
  content: HTMLDivElement;
}

export function createThinkingBlock(): ThinkingElements {
  const details = document.createElement('details');
  details.className = 'thinking-block';
  details.open = true;

  const summary = document.createElement('summary');
  summary.className = 'thinking-summary';
  summary.textContent = t('ai.thinking');
  details.appendChild(summary);

  const content = document.createElement('div');
  content.className = 'thinking-content';
  details.appendChild(content);

  return { details, content };
}

export function createContentBlock(): HTMLDivElement {
  const contentEl = document.createElement('div');
  contentEl.className = 'thinking-response-content';
  return contentEl;
}
```

- [ ] **Step 2: Update `stream-handler.ts`**

Replace inline DOM creation with calls to the new helpers:

```typescript
import { createThinkingBlock, createContentBlock } from '../ui/dom-helpers';
```

Replace the thinking block creation (lines 66-78) with:
```typescript
if (isCurrentTab() && msgEl.isConnected && !thinkingEl) {
  const thinking = createThinkingBlock();
  thinkingEl = thinking.details;
  thinkingContentEl = thinking.content;
  msgEl.appendChild(thinkingEl);
}
```

Replace content block creation (lines 90-93) with:
```typescript
if (isCurrentTab() && msgEl.isConnected && !contentEl) {
  contentEl = createContentBlock();
  msgEl.appendChild(contentEl);
}
```

- [ ] **Step 3: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/ui/dom-helpers.ts src/side_panel/services/stream-handler.ts
git commit -m "refactor: extract thinking block rendering to UI helpers"
```

---

## Phase 4: Split Large Files

### Task 16: Split chat-history.ts into modules

**Files:**
- Create: `src/side_panel/features/chat-history/index.ts`
- Create: `src/side_panel/features/chat-history/storage.ts`
- Create: `src/side_panel/features/chat-history/renderer.ts`
- Create: `src/side_panel/features/chat-history/export.ts`
- Delete: `src/side_panel/features/chat-history.ts`

- [ ] **Step 1: Create `storage.ts`**

Extract `getChatHistories()` and `saveChatHistories()` from `chat-history.ts`:

```typescript
// src/side_panel/features/chat-history/storage.ts
const STORAGE_KEY = 'chatHistories';
const MAX_HISTORIES = 50;

export interface ChatHistoryEntry {
  id: string;
  title: string;
  pageTitle?: string;
  messages: DisplayMessage[];
  conversationHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ... (copy interfaces and functions)
```

- [ ] **Step 2: Create `renderer.ts`**

Extract `renderHistoryList()`, `loadChat()`, `getDisplayMessages()`.

- [ ] **Step 3: Create `export.ts`**

Extract `exportChatAsMarkdown()`, `sanitizeFilename()`, `stripHtml()`, `generateTitle()`. Use `formatDateTime` and `formatDateOnly` from `shared/format.ts` instead of manual `padStart`.

- [ ] **Step 4: Create `index.ts` facade**

Re-export the public API so existing imports continue to work:

```typescript
// src/side_panel/features/chat-history/index.ts
export { initChatHistory, saveCurrentChat, deleteChat, renderHistoryList, getDisplayMessages, exportChatAsMarkdown, generateTitle, sanitizeFilename, stripHtml } from './renderer';
export type { ChatHistoryEntry, ChatLoadData, DisplayMessage, ChatHistoryInitDeps } from './storage';
```

- [ ] **Step 5: Update imports**

Files that import from `features/chat-history`:
- `ui/global-events.ts`
- `main.ts`
- `features/suggest-questions.ts` (if applicable)

Verify these imports still resolve correctly via the facade.

- [ ] **Step 6: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/side_panel/features/chat-history.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/side_panel/features/chat-history/
git commit -m "refactor: split chat-history into storage, renderer, and export modules"
```

---

### Task 17: Split outline.ts into modules

**Files:**
- Create: `src/side_panel/features/outline/index.ts`
- Create: `src/side_panel/features/outline/parser.ts`
- Create: `src/side_panel/features/outline/renderer.ts`
- Create: `src/side_panel/features/outline/generator.ts`
- Delete: `src/side_panel/features/outline.ts`

- [ ] **Step 1: Create `parser.ts`**

Extract: `parseOutlineResponse()`, `outlineToMarkdown()`, `sectionToMarkdown()`, and the `OutlineSection`/`OutlineData` interfaces.

- [ ] **Step 2: Create `renderer.ts`**

Extract: `renderOutlineNode()`, `renderOutline()`, `renderOutlineSkeleton()`, `renderOutlineFromJSON()`.

- [ ] **Step 3: Create `generator.ts`**

Extract: `generateOutline()`, `doGenerateOutline()`, and the `initOutline()` function.

- [ ] **Step 4: Create `index.ts` facade**

```typescript
export { parseOutlineResponse, outlineToMarkdown, sectionToMarkdown } from './parser';
export { renderOutlineFromJSON } from './renderer';
export { generateOutline, initOutline } from './generator';
export type { OutlineSection, OutlineData } from './parser';
```

- [ ] **Step 5: Update imports**

Files importing from `features/outline`:
- `main.ts`
- `ui/global-events.ts`
- `chat-history/export.ts` (if applicable)

- [ ] **Step 6: Verify type check and tests**

Run: `npx tsc --noEmit && npx vitest run tests/side_panel/features/outline.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/side_panel/features/outline/
git commit -m "refactor: split outline into parser, renderer, and generator modules"
```

---

### Task 18: Extract rendering from stream-handler.ts

**Files:**
- Create: `src/side_panel/ui/stream-renderer.ts`
- Modify: `src/side_panel/services/stream-handler.ts`

- [ ] **Step 1: Create `stream-renderer.ts`**

Move the following rendering logic from `callAI()`:
- Thinking block update logic
- Content block update logic
- Done handler rendering (TTS button, suggest questions emit)
- Error handler rendering

Keep in `stream-handler.ts`:
- Port connection and message handling (protocol layer)
- State management (`isGenerating`, `conversationHistory`)
- The overall `callAI()` orchestration

- [ ] **Step 2: Update `stream-handler.ts`**

Import from `stream-renderer.ts` and delegate rendering calls.

- [ ] **Step 3: Verify type check and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/ui/stream-renderer.ts src/side_panel/services/stream-handler.ts
git commit -m "refactor: extract stream rendering logic from callAI god function"
```

---

## Phase 5: Fix Global Events Layer Violation

### Task 19: Refactor global-events to use event bus

**Files:**
- Modify: `src/side_panel/ui/global-events.ts`
- Modify: `src/side_panel/features/chat-history/index.ts` (or `renderer.ts`)

- [ ] **Step 1: Add event listener in chat-history**

In `chat-history/renderer.ts` (or `index.ts`), register the handler during init:

```typescript
import { on, EVENTS } from '../../events';

// Inside initChatHistory or module-level:
on(EVENTS.RENDER_HISTORY_LIST, () => { renderHistoryList(); });
```

- [ ] **Step 2: Update `global-events.ts`**

Remove direct imports from `features/chat-history`:

```typescript
// Before
import { renderHistoryList } from '../features/chat-history';

// After — remove this import
```

Replace direct calls with events:

```typescript
// Before
renderHistoryList();

// After
emit(EVENTS.RENDER_HISTORY_LIST);
```

- [ ] **Step 3: Verify no UI → Features imports remain**

Run: `npx tsc --noEmit`
Check: `global-events.ts` should only import from `shared/` and `state.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/ui/global-events.ts src/side_panel/features/chat-history/
git commit -m "refactor: remove UI→Features layer violation in global-events"
```

---

## Phase 6: Cleanup

### Task 20: Use formatDateTime in chat export

**Files:**
- Modify: `src/side_panel/features/chat-history/export.ts`

- [ ] **Step 1: Replace manual date formatting**

In `exportChatAsMarkdown()`, replace:

```typescript
const now = new Date();
const exportTime = now.getFullYear() + '-' +
  String(now.getMonth() + 1).padStart(2, '0') + '-' +
  String(now.getDate()).padStart(2, '0') + ' ' +
  String(now.getHours()).padStart(2, '0') + ':' +
  String(now.getMinutes()).padStart(2, '0');
```

with:

```typescript
import { formatDateTime, formatDateOnly } from '../../../shared/format';
const now = new Date();
const exportTime = formatDateTime(now);
```

Also replace the filename date formatting:

```typescript
const dateStr = formatDateOnly(now);
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/side_panel/features/chat-history.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/features/chat-history/export.ts
git commit -m "refactor: use formatDateTime utilities in chat export"
```

---

### Task 21: Remove debug console.log statements

**Files:**
- Modify: `src/content/chart-detector.ts`
- Modify: `src/side_panel/services/chart-extract.ts`

- [ ] **Step 1: Remove from `chart-detector.ts`**

Remove line 27: `console.log(logTag, 'sending captureChartScreenshot:...');`

- [ ] **Step 2: Remove from `chart-extract.ts`**

Remove line 79: `console.log('[AI Reader] captureChart sending to tab'...);`

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/content/chart-detector.ts src/side_panel/services/chart-extract.ts
git commit -m "chore: remove debug console.log statements from production code"
```

---

### Task 22: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS (produces `dist/` directory)

- [ ] **Step 5: Final commit with all changes**

```bash
git add -A
git commit -m "refactor: complete codebase refactoring — utilities, layer fixes, file splits, typed events"
```
