# AGENTS.md

## Build & Run

```bash
npm run dev    # vite build --watch + watch-iife for content/background (development)
npm run build  # vite build && node build-extension.js (production)
npm run test   # vitest run (957 tests across 65 files; proxy test file needs `ws` installed — see Testing)
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
- Type definitions: `src/shared/types.ts` (TabState, ChatMessage, ToolCall)
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
- `message-sender.ts` — message assembly and sending; `submit(intent)` is the single send pipeline (send button, quick actions, quick commands); delegates history ops to `chat/history-ops.ts`
- `composer.ts` — owns the draft (input text + pending images): `consumeAttachments()` and `setDraftText/appendDraftText/clearDraftText` (fire `input` so resize / send-button dim stay in sync)
- `images.ts` — image intake + preview bar
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
- Events: RETRY, EDIT, REMOVE_SUGGEST_QUESTIONS, REQUEST_RERENDER, GENERATE_SUGGESTIONS, CLEAR_QUOTE_PREVIEW, PODCAST_CLICK, ADD_TTS_BUTTON, SAVE_CURRENT_CHAT, RENDER_HISTORY_LIST, SHOW_RELATED_PAGES, PAGE_EXTRACTED, PODCAST_REBUILD_REQUEST
- `PAGE_EXTRACTED` decouples `page-extractor` (service) from `related-pages` (feature) — the service emits, the feature subscribes
- `PODCAST_REBUILD_REQUEST` is the same pattern: `ui/tab-switch-handler` emits after rebuilding the chat area on tab switch, the podcast feature subscribes to rebuild its card — keeps `ui/**` from importing the feature

## Chrome Extension Messaging

- **Streaming** (AI chat, TTS, suggest questions): `chrome.runtime.connect` with named ports (`ai-chat`, `tts`, `suggest`). Prefer `src/platform/ports.ts` openers + `src/shared/protocol.ts` types over raw `chrome.runtime.connect`.
- **One-shot** (page extract, selection relay, model list): `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage`. Prefer `src/platform/messaging.ts` wrappers.
- **Config sync**: `chrome.storage.onChanged` listeners — prefer `platform/storage.ts` `onSyncChange(key, cb)` over raw listeners (replaces previously duplicated boilerplate). Changes apply live without reload.

## API Path Convention

`apiBase` does **not** include `/v1`. Endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`.

## i18n

Strings in `src/shared/i18n.js` keyed by dot-notation. DOM auto-translates via `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-title` attributes.

## LLM Prompts

All LLM prompts live in `src/shared/prompts.ts` — **not** `i18n.js`. Prompts are semantically distinct from UI strings (they never bind to `data-i18n`) and `i18n.js` is unsafe to import from the service worker (it touches `document`). `prompts.ts` is pure data + a pure `getPrompt(key, lang?, params?)` getter, importable from both the SW (`sw-annotation.ts`) and the side panel. Keys are typed (`PromptKey`); zh is complete, en is partial (podcast is zh-only because its TTS voices are Chinese). Side-panel callers pass `getCurrentLang()` from `i18n.js`; the SW reads `language` from `chrome.storage.sync` and normalizes to `'zh'|'en'`. Built-in quick-action prompts follow the UI language (zh + en both defined).

## Testing

- **Vitest** with jsdom environment, 957 tests across 65 files
- **Proxy tests need proxy deps**: `tests/proxy/protocol.test.js` imports `proxy/server.js`, which requires `ws`. Run `cd proxy && npm install` once, or that file fails with "Cannot find module 'ws'" while everything else passes
- Chrome mock: `tests/helpers/chrome-mock.js` (programmable port, storage, tabs)
- Platform layer tests (`tests/platform/`) mock `chrome.*` via `vi.stubGlobal` — the single seam for Chrome API isolation
- Coverage (`npm run test:coverage`): includes `src/**/*.{js,ts}` + `proxy/**/*.js`; excludes pure type defs and entry orchestrators (`main.ts`, `options/index.ts`, `content/index.ts`). Enforces thresholds — lines 55 / functions 50 / branches 45 / statements 52 — failing them fails the run
- **Circular dependencies**: run `npx madge --circular --extensions ts,js src/` — currently 1 known cycle (`ui/global-events` ↔ `ui/tab-switch-handler`, pre-existing)

## Docs

`docs/superpowers/specs/` (design docs) and `docs/superpowers/plans/` (implementation plans) hold one dated pair per feature (e.g. `2026-06-20-deep-annotation-design.md`). Read the relevant spec before changing a feature's behavior.

## Key Gotchas

- `dist/` is the loadable extension — do not reference `public/manifest.json` paths directly when reasoning about the running extension
- Content script and service worker must be IIFE — they cannot use `import` at runtime
- `Readability` is imported from `@mozilla/readability` npm package, not a local file
- `proxy/` is a standalone Node.js server for the podcast feature (separate `package.json`, runs on `localhost:3456`)
- Theme CSS uses compound selectors: `[data-theme-name="ocean"][data-theme="dark"]`
- TTS SSE events: `352`=audio chunk, `152`=session finish (may appear twice), `153`=failure
- `vitest.config.js` coverage enforces thresholds (lines 55 / functions 50 / branches 45 / statements 52) — regressing coverage fails `npm run test:coverage`
- **Stop button**: while streaming, the send button becomes Stop; `abortGeneration(tabId)` in `services/stream-handler.ts` aborts by calling `port.disconnect()` — there is no wire-level abort message, the SW keys cleanup off port disconnect
- **IME-safe Enter**: keydown handlers that send on Enter must guard `e.isComposing || e.keyCode === 229` (IME composition, see `ai-chat.ts`) — otherwise Chinese/Japanese input sends mid-composition
- `scripts/watch-iife.js` does NOT include the esbuild plugin (unlike `build-extension.js`) — TypeScript in content/background is only transpiled during production build, not in dev watch mode
- **Layering guardrail**: ESLint `no-restricted-imports` for `side_panel/ui/**` is `warn` (base rule is `off` during the refactor); it blocks ui/ imports of services/, features/, and a planned `shell/` orchestration layer that does **not exist yet** — `ui/global-events.ts` is slated to move there in a future phase. Note: ESLint only lints `.js` by default (no typescript-eslint plugin); `.ts` layering is enforced via tsc + review.
- **Image intake**: `services/images.ts` `ingestImages()` is the single entry point for adding images (upload button + paste + drag-drop all funnel through it). The chat model is assumed multimodal: images are always sent as `image_url` parts — there is no OCR fallback and no vision toggle (GLM-OCR and `visionEnabled` were removed; the options page clears the stale keys on save).
- **Sending**: every entry point that sends to the model goes through `submit()` / `services/composer.ts` — never read `userInput.value` or the preview bar directly. A non-empty draft rides along with quick actions / quick commands as extra instructions (`draft.supplement` prompt); suggestion chips only fill the input.
- **History operations**: use `services/chat/history-ops.ts` (`appendMessage`/`rollbackTrailingUserMessage`/`truncateHistoryFromUserContent`) instead of mutating `tabState.conversationHistory` directly — it centralizes persistence + rollback policy.
- **State persistence**: `state.ts` field setters persist to `chrome.storage.session` debounced (250ms); conversation helpers + `persistForTab()` flush immediately, and `switchToTab()` flushes the outgoing tab. Add new TabState fields as explicit getter/setter pairs — the runtime `defineTabField` name-synthesis was removed.
- **SW chat streaming**: all chat-completions SSE goes through one pipeline — `streamChatCompletion()` in `sw-openai.ts` (callers: `callOpenAI`, `callSuggestQuestions`, podcast-llm via `callOpenAI`). The delta-parse point for future `tool_calls` is that single function.
- **Agent Readiness**: `ChatMessage` has reserved `tool_calls`/`tool_call_id`/`name` fields and `role: 'tool'`. `sw-openai.ts` and `shared/protocol.ts` have `AGENT TODO` markers showing where tool-call support plugs in. These are type-only reservations — no runtime tool-calling exists yet.
- **Related Reading / 知识关联** (`features/related-pages.ts`): page records live in **IndexedDB** (`shared/page-records-db.ts`, DB `ai-reader`, store `pageRecords`, keyPath `normalizedUrl`; computed via `shared/url-normalize.ts` — strips hash + utm/ref/source/from/gclid/fbclid/spm/share_*, sorts remaining params, lowercases host, drops trailing slash). All record writes (upsert by normalizedUrl + FIFO eviction beyond `embeddingMaxPages`) and cosine-similarity ranking run in the **service worker** (`background/sw-related-pages.ts` + `shared/vector.ts`); the panel only sends one-shot `pageRecords:store` / `pageRecords:findRelated` messages (types in `shared/protocol.ts`). Legacy `chrome.storage.local['pageRecords']` records are migrated to IndexedDB once by the worker (`migrateLegacyPageRecords`, awaited before any store/find). Embedding config (`embeddingApiKey`/`embeddingApiBase`/`embeddingModel`) must be set **independently** in the options page — there is no fallback to the chat provider, and any missing field surfaces as `not-configured` status (one of the panel's seven states: `idle/loading/results/empty/error/disabled/not-configured`). After each successful `pageRecords:store`, the panel auto-refreshes the current URL (debounced 300ms) — no tab switch needed. On failure the panel shows `error` status + a retry button. The options page clears records via `clearPageRecords()` from `shared/page-records-db.ts` (IndexedDB is same-origin across extension contexts).
