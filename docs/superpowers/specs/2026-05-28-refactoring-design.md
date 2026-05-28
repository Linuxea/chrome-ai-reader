# Refactoring Design: chrome-ai-reader

## Overview

Comprehensive refactoring of the chrome-ai-reader codebase to fix architecture violations, reduce code duplication, improve maintainability, and add type safety to the event bus. The `init*()` singleton pattern is preserved as-is.

## Current State

- 58 TS files + 1 JS file (i18n.js), ~9,900 lines total
- 5-layer architecture: shared → state → UI → services → features
- Average file size: ~171 lines, only 1 file exceeds 300 lines
- Clean layer hierarchy (mostly respected), no circular dependencies

## Key Issues Identified

| Priority | Issue | Impact |
|----------|-------|--------|
| P0 | `stream-handler.ts` `callAI()` god function (153 lines) | Most-modified code path |
| P0 | Service layer directly manipulates DOM (`ocr.ts`, `tts/index.ts`, `stream-handler.ts`) | Architecture violation |
| P1 | Duplicated MediaSource streaming logic (~80 lines) | Maintainability |
| P1 | Duplicated OCR guard/validation logic | DRY violation |
| P1 | `chat-history.ts` (316 lines) mixes 4+ concerns | Single-responsibility |
| P1 | UI → Features layer violation in `global-events.ts` | Layer boundary |
| P2 | Untyped event bus payloads | Developer experience |
| P2 | Hard-coded CSS selectors scattered across modules | Fragility |
| P2 | `outline.ts` mixes JSON parsing + DOM + streaming | Maintainability |
| P3 | 72 try/catch blocks with repeated `(e as Error).message` | DRY |

---

## Phase 1: Shared Utilities & Type Foundation

**Goal:** Extract duplicated patterns into shared utilities and establish typed event bus foundation.

### 1.1 Create `src/shared/utils.ts` — Error handling utility

Extract the repeated `(e as Error).message` pattern:

```typescript
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}
```

**Files changed:** `src/shared/utils.ts` (new), then update all 72 try/catch blocks across the codebase to use `toErrorMessage(e)`.

### 1.2 Create `src/shared/chrome-helpers.ts` — Chrome API utilities

Extract duplicated Chrome cleanup patterns:

```typescript
/** Safely disconnect a Chrome port, ignoring AlreadyClosed errors */
export function safePortDisconnect(port: chrome.runtime.Port | null): void {
  if (!port) return;
  try { port.disconnect(); } catch { /* port already disconnected */ }
}

/** Safely end a MediaSource stream if open */
export function safeEndOfStream(ms: MediaSource | null): void {
  if (!ms || ms.readyState !== 'open') return;
  try { ms.endOfStream(); } catch { /* network error or invalid state */ }
}
```

**Files changed:** `src/shared/chrome-helpers.ts` (new), then update `tts/player.ts`, `tts/downloader.ts`, `podcast/audio.ts`, `podcast/script.ts`.

### 1.3 Create `src/shared/css-selectors.ts` — Centralized CSS selectors

Replace scattered string literals with typed constants:

```typescript
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
} as const;
```

**Files changed:** `src/shared/css-selectors.ts` (new), then update all files that use these selectors (8+ files).

### 1.4 Type the event bus in `src/side_panel/events.ts`

Define a typed event map:

```typescript
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
}

export function on<K extends EventName>(event: K, handler: EventMap[K]): () => void;
export function emit<K extends EventName>(event: K, ...args: Parameters<EventMap[K]>): void;
```

**Files changed:** `src/side_panel/events.ts`, then update all event handler registrations to remove manual type casts.

### 1.5 Extract OCR validation guard

Create a shared validation function used by both `message-sender.ts` and `quick-action-handler.ts`:

```typescript
// In src/side_panel/services/ocr.ts (add to existing module)
export function validateImageState(): string | null {
  if (state.getOcrRunning() > 0) return t('error.ocrRunning');
  if (hasImageErrors()) {
    const firstError = document.querySelector(CSS.IMAGE_PREVIEW_ERROR);
    const reason = firstError?.getAttribute('title') || '';
    return t('error.ocrPartialFail') + (reason ? `：${reason}` : '');
  }
  return null;
}
```

**Files changed:** `src/side_panel/services/ocr.ts`, `src/side_panel/services/message-sender.ts`, `src/side_panel/services/quick-action-handler.ts`.

### Verification

- `npm run test` — all existing tests pass
- `npm run lint` — no new lint errors
- `npx tsc --noEmit` — type check passes
- Grep for `(e as Error).message` — should only appear in tests

---

## Phase 2: Extract Shared Audio Stream Player

**Goal:** Eliminate ~80 lines of duplicated MediaSource + SourceBuffer logic between TTS and Podcast.

### 2.1 Create `src/shared/audio-stream.ts`

```typescript
interface AudioStreamOptions {
  mimeType: string;
  onFirstChunkPlayed?: () => void;
  onEnded?: () => void;
}

interface AudioStreamHandle {
  appendChunk(base64Data: string): void;
  finish(): void;
  destroy(): void;
  audioEl: HTMLAudioElement;
}

export function createAudioStream(options: AudioStreamOptions): AudioStreamHandle {
  // Shared MediaSource + SourceBuffer + chunk queue logic
  // Returns handle for appending chunks and cleanup
}
```

This extracts the common pattern from `tts/player.ts` (lines 78-108) and `podcast/audio.ts` (lines 37-61):
- MediaSource creation and `sourceopen` handler
- SourceBuffer setup with `audio/mpeg` MIME
- `updateend` listener for buffer management
- Chunk queue with `appendBuffer` logic
- Base64 decoding (`atob` → `Uint8Array` → `ArrayBuffer`)
- `endOfStream()` on finish
- Cleanup (pause, disconnect, nullify)

### 2.2 Refactor `src/side_panel/services/tts/player.ts`

Replace inline MediaSource logic with `createAudioStream()`. Keep the sentence queue and TTS-specific logic (auto-play, sentence segmentation) as wrapper code.

### 2.3 Refactor `src/side_panel/features/podcast/audio.ts`

Replace inline MediaSource logic with `createAudioStream()`. Keep podcast-specific logic (round timings, seek, download, transcript highlighting) as wrapper code.

### Verification

- `npm run test` — all existing tests pass
- Manual testing: TTS playback works, podcast playback works
- Verify chunk queue behavior with slow connections

---

## Phase 3: Fix Layer Violations (Service → UI)

**Goal:** Move DOM manipulation out of service layer modules.

### 3.1 Extract TTS button creation from `tts/index.ts`

Move `addTTSButton()` (lines 65-108) to a new UI module `src/side_panel/ui/tts-buttons.ts`:

```typescript
// src/side_panel/ui/tts-buttons.ts
export function createTTSButtons(msgEl: HTMLElement): void {
  // Copy button, TTS button, download button creation
  // Event handlers use callbacks passed as parameters
}
```

`src/side_panel/services/tts/index.ts` will import from `ui/tts-buttons.ts` and call it when needed. The TTS service only handles playback logic; UI construction moves to the UI layer.

### 3.2 Extract OCR UI from `ocr.ts`

Split `ocr.ts` into:
- `src/side_panel/services/ocr.ts` — OCR API calls, text extraction, context building (pure service)
- `src/side_panel/ui/ocr-preview.ts` — Image preview bar, status indicators, remove buttons (UI)

The `initOCR()` function will be split: event binding stays in the UI module, OCR API calls stay in the service module.

### 3.3 Extract thinking block rendering from `stream-handler.ts`

Move thinking block DOM creation (lines 66-83) to a helper in `ui/dom-helpers.ts`:

```typescript
export function createThinkingBlock(): { details: HTMLDetailsElement; content: HTMLDivElement };
export function updateThinkingBlock(content: HTMLDivElement, text: string): void;
```

### Verification

- `npm run test` — all tests pass
- `npx tsc --noEmit` — no type errors
- Grep for DOM manipulation in `src/side_panel/services/` — should only appear in `tts-buttons.ts` (UI layer) and `dom-helpers.ts`

---

## Phase 4: Split Large Files

**Goal:** Break files with mixed concerns into focused modules.

### 4.1 Split `chat-history.ts` (316 lines → 3 modules)

**New structure:**
```
src/side_panel/features/chat-history/
├── index.ts          # Facade: re-exports public API
├── storage.ts        # Chrome storage CRUD (getChatHistories, saveChatHistories)
├── renderer.ts       # DOM rendering (renderHistoryList, loadChat)
└── export.ts         # Markdown export (exportChatAsMarkdown, sanitizeFilename, stripHtml)
```

The `index.ts` facade preserves the existing public API so no other files need changes.

### 4.2 Split `outline.ts` (284 lines → 3 modules)

**New structure:**
```
src/side_panel/features/outline/
├── index.ts          # Facade: re-exports public API
├── parser.ts         # JSON parsing/repair (parseOutlineResponse, outlineToMarkdown, sectionToMarkdown)
├── renderer.ts       # DOM rendering (renderOutlineNode, renderOutline, renderOutlineSkeleton)
└── generator.ts      # Streaming orchestration (generateOutline, doGenerateOutline, renderOutlineFromJSON)
```

### 4.3 Split `stream-handler.ts` — Extract `callAI` rendering logic

The `callAI()` function (153 lines) mixes streaming protocol with DOM rendering. Extract rendering into `src/side_panel/ui/stream-renderer.ts`:

```typescript
// Rendering concerns
export function createThinkingElements(msgEl: HTMLElement): ThinkingElements;
export function updateThinkingContent(thinking: ThinkingElements, text: string): void;
export function createContentBlock(msgEl: HTMLElement): HTMLDivElement;
export function updateContentBlock(contentEl: HTMLDivElement, text: string): void;
```

`callAI()` becomes a thin orchestrator: connect port → handle messages → delegate rendering → manage state.

### Verification

- `npm run test` — all tests pass
- Verify import paths are correct (facade pattern)
- Check no circular dependencies introduced

---

## Phase 5: Fix Global Events Layer Violation

**Goal:** Resolve bidirectional dependency between `ui/global-events.ts` and features layer.

### 5.1 Refactor `ui/global-events.ts`

Current problem: `global-events.ts` imports from `features/quick-commands.ts` and `features/chat-history.ts`, creating a UI → Features dependency.

**Solution:** Use the event bus for cross-layer communication. Instead of direct imports:

```typescript
// Before (layer violation)
import { renderHistoryList } from '../features/chat-history';
import { handleQuickAction } from '../features/quick-commands';

// After (event-driven)
emit(EVENTS.RENDER_HISTORY_LIST);
emit(EVENTS.HANDLE_QUICK_ACTION, { action });
```

Features register their handlers during `init*()`:
```typescript
// In features/chat-history/index.ts init
on(EVENTS.RENDER_HISTORY_LIST, () => renderHistoryList());
```

### 5.2 Add new events to `EVENTS` enum

```typescript
RENDER_HISTORY_LIST: 'renderHistoryList',
HANDLE_QUICK_ACTION: 'handleQuickAction',
```

### Verification

- `npm run test` — all tests pass
- Import graph: `ui/global-events.ts` only imports from `shared/` and `state.ts`
- No bidirectional dependency between UI and features layers

---

## Phase 6: Date Formatting & Remaining Cleanup

**Goal:** Fix remaining DRY violations and clean up.

### 6.1 Fix date formatting in `chat-history/export.ts`

Replace manual `padStart` date formatting (lines 274-279, 312-314) with a new `formatDateTime()` utility in `shared/format.ts`:

```typescript
export function formatDateTime(date: Date): string {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0') + ' ' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
}

export function formatDateOnly(date: Date): string {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}
```

### 6.2 Remove debug `console.log` statements

Remove from:
- `content/chart-detector.ts:27` — `console.log(logTag, 'sending captureChartScreenshot:...')`
- `services/chart-extract.ts:79` — `console.log('[AI Reader] captureChart sending to tab'...)`

### 6.3 Clean up `isGenerating` guard pattern

Extract the repeated pattern from 5+ locations into a utility:

```typescript
// In src/side_panel/state.ts (add to existing module)
export function withGenerationGuard(fn: () => void): void {
  if (getIsGenerating()) return;
  setIsGenerating(true);
  setButtonsDisabled(true);
  try {
    fn();
  } finally {
    // Note: finally only for synchronous guard; async paths handle cleanup in their own catch/finally
  }
}
```

Note: This is a partial extraction since most call sites have async cleanup logic. The main value is centralizing the guard check + state set.

### Verification

- `npm run test` — all tests pass
- `npm run lint` — no warnings
- Grep for `padStart` in export functions — should use shared utility
- Grep for `console.log` in `src/` — only intentional info logs remain

---

## Execution Order & Dependencies

```
Phase 1 (Shared Utilities)
  ├── 1.1 toErrorMessage
  ├── 1.2 chrome-helpers
  ├── 1.3 css-selectors
  ├── 1.4 typed events
  └── 1.5 OCR guard
       │
Phase 2 (Audio Stream) ← depends on 1.2
       │
Phase 3 (Layer Fixes) ← depends on 1.3, 1.4
       │
Phase 4 (Split Files) ← depends on 1.4
       │
Phase 5 (Global Events) ← depends on 1.4
       │
Phase 6 (Cleanup) ← depends on all above
```

Each phase is a separate branch/PR, fully tested before merging.

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking Chrome extension messaging | Keep port names and message formats unchanged |
| Audio playback regression | Manual testing of TTS and podcast features |
| Event handler type mismatches | TypeScript compiler catches at build time |
| Import path breakage from file splits | Facade pattern preserves public API |
| i18n string breakage | No string changes, only structural refactoring |

## Out of Scope

- Converting `init*()` pattern to classes/closures (user preference: keep as-is)
- Refactoring `state.ts` metaprogramming (P3, low ROI)
- Rewriting test files (tests import from specific paths that will change — update imports only)
