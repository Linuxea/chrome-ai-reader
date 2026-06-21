# AGENTS.md

## Build & Run

```bash
npm run dev    # vite build --watch + watch-iife for content/background (development)
npm run build  # vite build && node build-extension.js (production)
npm run test   # vitest run (829 tests across 58 files)
npm run test:watch  # vitest (watch mode)
npm run test:coverage  # vitest run --coverage
npm run lint   # eslint src/ proxy/
npm run format # prettier --write 'src/**/*.js' 'proxy/**/*.js'
npx tsc --noEmit  # TypeScript type check (strict:true)
```

**`npm run dev` watches Vite + IIFE builds** via `concurrently`. All source changes (side panel, options, content script, background) are rebuilt on save.

## Build Architecture (non-obvious)

Two-phase build — Chrome cannot use ES modules for content scripts or service workers:

1. **Vite** (`vite.config.js`) — bundles `src/side_panel/index.html` and `src/options/index.html` as entry points. Output: `dist/` with chunked JS in `dist/assets/`. Native TypeScript support via esbuild.
2. **Rollup IIFE** (`build-extension.js`) — bundles `src/content/index.ts` → `dist/content.js` and `src/background/service-worker.ts` → `dist/background.js` as self-contained IIFE scripts. Uses `rollup-plugin-esbuild` for TypeScript.
3. **Static copy** — `public/` copied verbatim to `dist/` (manifest, icons).

Load the **`dist/`** directory in `chrome://extensions/`, not the project root.

## TypeScript

- **strict: true** — all `.ts` files are strict-mode TypeScript
- `tsconfig.json` — `noEmit: true`, `allowJs: true` (JS/TS coexist)
- Only `src/shared/i18n.js` and `src/shared/types.js` remain as JS (JSDoc typedefs for legacy consumers; TS types are in `types.ts`)
- Type definitions: `src/shared/types.ts` (TabState, ChatMessage, ChartInfo, OcrResult, ToolCall)
- Error handling: `src/shared/result.ts` (Result<T,E>, ok(), err())
- `ChatMessage.role` includes reserved `'tool'` + optional `tool_calls`/`tool_call_id` fields — **reserved for future agent architecture, not yet wired** (see sw-openai.ts AGENT TODO markers)

## Source Layout (`src/`)

6-layer dependency hierarchy. Modules export `init*()` functions called bottom-up from `src/side_panel/main.ts`:

| Layer | Directory | Depends on |
|-------|-----------|------------|
| Shared | `src/shared/` | nothing |
| Platform | `src/platform/` | shared (typed wrappers over `chrome.*`) |
| State | `src/side_panel/state.ts` | shared + platform |
| UI | `src/side_panel/ui/` | shared + state |
| Services | `src/side_panel/services/` | shared + platform + state + UI |
| Features | `src/side_panel/features/` | services + UI + state |

**Platform layer (`src/platform/`)** — single seam for all `chrome.*` access:
- `ports.ts` — typed `openXxxPort()` helpers + `PORT_NAMES` (single source of truth for port names)
- `storage.ts` — `getSync/setSync/onSyncChange` (onSyncChange replaces duplicated storage.onChanged listeners)
- `tabs.ts` — `getActiveTab/onTabActivated/onTabRemoved`
- `messaging.ts` — `sendMessage/onMessage/openOptionsPage`

**Key sub-modules (services):**
- `page-extractor.ts` — page content extraction (returns `Result<ExtractResult>`); emits `PAGE_EXTRACTED` event instead of importing the related-pages feature upward
- `message-sender.ts` — message assembly and sending; delegates history ops to `chat/history-ops.ts`
- `stream-handler.ts` — SSE streaming + thinking block rendering
- `quick-action-handler.ts` — quick action dispatch
- `ai-chat.ts` — chat UI orchestration (sendBtn/keydown/action-btn wiring); **no longer re-exports** extractPageContent/sendToAI — import those from their real home
- `chat/history-ops.ts` — centralized conversation history operations (appendMessage, rollbackTrailingUserMessage, truncateHistoryFromUserContent); replaces 3 previously duplicated rollback blocks

**Shared protocol (`src/shared/protocol.ts`)** — single source of truth for Port wire contracts (`StreamMessage`, `AIChatRequest`, `TTSMessage`, etc.). Pair with `PORT_NAMES`.

**Other entry points:**
- `src/content/index.ts` — content script (IIFE-bundled)
- `src/content/annotation/` — annotation split into focused modules (chunk-collector, quote-wrapper, bubble-ui, orchestrator, styles); `content/annotation.ts` is a barrel re-export
- `src/background/service-worker.ts` — background worker (IIFE-bundled)
- `src/options/index.ts` — settings page (bundled by Vite, split into sections/)

## Event System

- `src/side_panel/events.ts` — lightweight synchronous event bus
- `EVENTS` constant enum — all event names are typed constants, no string magic keys
- Events: RETRY, REMOVE_SUGGEST_QUESTIONS, REQUEST_RERENDER, GENERATE_SUGGESTIONS, CLEAR_QUOTE_PREVIEW, PODCAST_CLICK, ADD_TTS_BUTTON, SAVE_CURRENT_CHAT, RENDER_HISTORY_LIST, SHOW_RELATED_PAGES, PAGE_EXTRACTED
- `PAGE_EXTRACTED` decouples `page-extractor` (service) from `related-pages` (feature) — the service emits, the feature subscribes

## Chrome Extension Messaging

- **Streaming** (AI chat, TTS, suggest questions): `chrome.runtime.connect` with named ports (`ai-chat`, `tts`, `suggest`). Prefer `src/platform/ports.ts` openers + `src/shared/protocol.ts` types over raw `chrome.runtime.connect`.
- **One-shot** (page extract, selection relay, model list, OCR): `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage`. Prefer `src/platform/messaging.ts` wrappers.
- **Config sync**: `chrome.storage.onChanged` listeners — prefer `platform/storage.ts` `onSyncChange(key, cb)` over raw listeners (replaces previously duplicated boilerplate). Changes apply live without reload.

## API Path Convention

`apiBase` does **not** include `/v1`. Endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`.

## i18n

Strings in `src/shared/i18n.js` keyed by dot-notation. DOM auto-translates via `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-title` attributes. Default prompts for built-in quick actions are always Chinese regardless of UI language.

## Testing

- **Vitest** with jsdom environment, 829 tests across 58 files
- Chrome mock: `tests/helpers/chrome-mock.js` (programmable port, storage, tabs)
- Platform layer tests (`tests/platform/`) mock `chrome.*` via `vi.stubGlobal` — the single seam for Chrome API isolation
- Coverage: ~30% overall, core modules 80%+ (dom-helpers 98%, theme 100%, sw-openai 91%, page-extractor 88%)
- Run `npm run test:coverage` for detailed coverage report
- **Circular dependencies**: run `npx madge --circular --extensions ts,js src/` — currently 1 known cycle (`ui/global-events` ↔ `ui/tab-switch-handler`, pre-existing)

## Key Gotchas

- `dist/` is the loadable extension — do not reference `public/manifest.json` paths directly when reasoning about the running extension
- Content script and service worker must be IIFE — they cannot use `import` at runtime
- `Readability` is imported from `@mozilla/readability` npm package, not a local file
- `proxy/` is a standalone Node.js server for the podcast feature (separate `package.json`, runs on `localhost:3456`)
- Theme CSS uses compound selectors: `[data-theme-name="ocean"][data-theme="dark"]`
- TTS SSE events: `352`=audio chunk, `152`=session finish (may appear twice), `153`=failure
- `vitest.config.js` coverage `include` pattern is `src/**/*.js` — most source files are now `.ts`, so coverage numbers may undercount; update pattern when adding TS test files
- `scripts/watch-iife.js` does NOT include the esbuild plugin (unlike `build-extension.js`) — TypeScript in content/background is only transpiled during production build, not in dev watch mode
- **Layering guardrail**: ESLint `no-restricted-imports` (warn) prevents `side_panel/ui/**` from importing services/features. Note: ESLint only lints `.js` by default (no typescript-eslint plugin); `.ts` layering is enforced via tsc + review.
- **Image intake**: `services/ocr.ts` `ingestImages()` is the single entry point for adding images (upload button + paste + drag-drop all funnel through it). Do not re-duplicate the index+FileReader+OCR loop.
- **History operations**: use `services/chat/history-ops.ts` (`appendMessage`/`rollbackTrailingUserMessage`/`truncateHistoryFromUserContent`) instead of mutating `tabState.conversationHistory` directly — it centralizes persistence + rollback policy.
- **Agent readiness**: `ChatMessage` has reserved `tool_calls`/`tool_call_id`/`name` fields and `role: 'tool'`. `sw-openai.ts` and `shared/protocol.ts` have `AGENT TODO` markers showing where tool-call support plugs in. These are type-only reservations — no runtime tool-calling exists yet.
