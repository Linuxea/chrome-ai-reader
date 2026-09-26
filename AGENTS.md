# AGENTS.md

## Build & Run

```bash
npm run dev    # vite build --watch + watch-iife for content/background (development)
npm run build  # vite build && node build-extension.js (production)
npm run test   # vitest run (1205 tests across 99 files; proxy test files need `ws` installed — see Testing)
npm run test:watch  # vitest (watch mode)
npm run test:coverage  # vitest run --coverage
npm run lint   # eslint (JS + TS via typescript-eslint) && lint:deps
npm run lint:deps  # dependency-cruiser: layer rules + no import cycles (.dependency-cruiser.cjs)
npm run format # prettier --write 'src/**/*.js' 'proxy/**/*.js'
npx tsc --noEmit  # TypeScript type check (strict:true)
```

**`npm run dev` watches Vite + IIFE builds** via `concurrently`. All source changes (side panel, options, content script, background) are rebuilt on save. The IIFE watcher and the production build share `scripts/iife-config.js` (entries + esbuild plugin); Vite's `emptyOutDir` is off in watch mode, because Vite empties `dist/` on every watch rebuild and would delete `content.js` / `background.js`.

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
- `ChatMessage.role` includes `'tool'` + optional `tool_calls`/`tool_call_id` fields — used by agent mode (F11, see Key Gotchas)

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
| Shell | `src/side_panel/shell/` | everything (composition root: global event wiring, tab switching; with `main.ts`) — nothing imports it |

Layering is **enforced**: `npm run lint:deps` (dependency-cruiser, runs in `npm run lint` and CI) fails on any upward import, on side panel ↔ background/content imports, on `shared/`/`platform/` importing app code, and on any import cycle. Type-only imports count too. Pure helpers used across layers go to `shared/` (e.g. `shared/strip-images.ts`); DOM primitives to `ui/` (e.g. `ui/quote-preview.ts`).

**Platform layer (`src/platform/`)** — single seam for all `chrome.*` access:
- `ports.ts` — typed `openXxxPort()` helpers over `PORT_NAMES` (defined in `shared/protocol.ts`, the single source of truth for port names — also usable from the SW / content script)
- `settings.ts` — **the** settings API: `readSettings(keys)` / `writeSettings` / `removeSettings` / `onSettingsChange` with typed keys (`Settings`) and defaults (`SETTING_DEFAULTS`). Secrets (`SECRET_KEYS`: `apiKey`, `ttsAccessKey`, `embeddingApiKey`) live in `storage.local` (never synced), everything else in `storage.sync`; callers never pick an area. `migrateSecretsToLocal()` runs at SW startup
- `storage.ts` — `getSync/setSync/onSyncChange` (low-level; prefer `settings.ts` for settings)
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
- Events: RETRY, EDIT, REMOVE_SUGGEST_QUESTIONS, REQUEST_RERENDER, GENERATE_SUGGESTIONS, CLEAR_QUOTE_PREVIEW, PODCAST_CLICK, ADD_TTS_BUTTON, SAVE_CURRENT_CHAT, RENDER_HISTORY_LIST, SHOW_RELATED_PAGES, PAGE_EXTRACTED, PODCAST_REBUILD_REQUEST, CHAT_RERENDERED, PODCAST_STOP_REQUEST, CITATION_CLICK, BRANCH_SWITCH
- `PAGE_EXTRACTED` decouples `page-extractor` (service) from `related-pages` (feature) — the service emits, the feature subscribes
- `PODCAST_REBUILD_REQUEST` is the same pattern: `ui/tab-switch-handler` emits after rebuilding the chat area on tab switch, the podcast feature subscribes to rebuild its card — keeps `ui/**` from importing the feature
- `PODCAST_STOP_REQUEST` is the same pattern for TTS↔podcast mutual exclusion: `services/tts` emits when a playback claims the audio resource, the podcast feature subscribes (services must not import features)

## Chrome Extension Messaging

- **Streaming** (AI chat, TTS, suggest questions): `chrome.runtime.connect` with named ports (`PORT_NAMES` in `shared/protocol.ts`: `ai-chat`, `tts`, `suggest-questions`, `podcast-*`, `annotation`, `translate`, …). The worker dispatches ports and one-shot messages through `background/sw-router.ts` (`registerPort` / `registerMessage` with an audience — `'extension'` pages or `'content'` scripts — checked against the sender; foreign senders are refused). Prefer `src/platform/ports.ts` openers + `src/shared/protocol.ts` types over raw `chrome.runtime.connect`.
- **One-shot** (page extract, selection relay, model list): `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage`. Prefer `src/platform/messaging.ts` wrappers.
- **Config sync**: prefer `platform/settings.ts` `onSettingsChange` (or `platform/storage.ts` `onSyncChange(key, cb)`) over raw `chrome.storage.onChanged` listeners. Changes apply live without reload.

## API Path Convention

`apiBase` does **not** include `/v1`. Endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`.

## i18n

Strings in `src/shared/i18n.js` keyed by dot-notation. DOM auto-translates via `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-title` attributes.

## LLM Prompts

All LLM prompts live in `src/shared/prompts.ts` — **not** `i18n.js`. Prompts are semantically distinct from UI strings (they never bind to `data-i18n`) and `i18n.js` is unsafe to import from the service worker (it touches `document`). `prompts.ts` is pure data + a pure `getPrompt(key, lang?, params?)` getter, importable from both the SW (`sw-annotation.ts`) and the side panel. Keys are typed (`PromptKey`); zh is complete, en is partial (podcast is zh-only because its TTS voices are Chinese). Placeholders are substituted in ONE pass with a replacer function, so values (page text) are inserted verbatim — `$&` is not expanded and a `{placeholder}` inside a value is not re-expanded; unknown placeholders and JSON braces stay as-is. The annotation chunk labels are language-neutral `[#N]` (`content/annotation/chunk-collector.ts`), referenced by `annotation.user` in both languages. Side-panel callers pass `getCurrentLang()` from `i18n.js`; the SW reads `language` from `chrome.storage.sync` and normalizes to `'zh'|'en'`. Built-in quick-action prompts follow the UI language (zh + en both defined).

## Testing

- **Vitest** with jsdom environment, 1205 tests across 99 files
- **Proxy tests need proxy deps**: `tests/proxy/*.test.js` import `proxy/server.js`, which requires `ws`. Run `cd proxy && npm install` once, or that file fails with "Cannot find module 'ws'" while everything else passes
- Chrome mock: `tests/helpers/chrome-mock.js` (programmable port, storage, tabs)
- Platform layer tests (`tests/platform/`) mock `chrome.*` via `vi.stubGlobal` — the single seam for Chrome API isolation
- Coverage (`npm run test:coverage`): includes `src/**/*.{js,ts}` + `proxy/**/*.js`; excludes pure type defs and entry orchestrators (`main.ts`, `options/index.ts`, `content/index.ts`). Enforces thresholds — lines 55 / functions 50 / branches 45 / statements 52 — failing them fails the run
- **Circular dependencies**: none — `npm run lint:deps` fails on any cycle
- **CI** (`.github/workflows/ci.yml`, push to main + PRs): `tsc --noEmit` → `npm run lint` → `npm run test:coverage` → `npm run build`, with proxy deps installed for the proxy tests
- **Prompt guard** (`tests/shared/no-inline-prompts.test.ts`): fails on a chat message with a literal `content` or a CJK string literal anywhere in `src/` outside `shared/prompts.ts` (allowlist: `content/annotation-meta.ts`)

## Docs

`docs/superpowers/specs/` (design docs) and `docs/superpowers/plans/` (implementation plans) hold one dated pair per feature (e.g. `2026-06-20-deep-annotation-design.md`). Read the relevant spec before changing a feature's behavior.

## Key Gotchas

- **No inline `<script>` in extension pages**: MV3's CSP (`script-src 'self'`) silently blocks them — put pre-paint code in `public/` (e.g. `public/theme-boot.js`) and reference it with `<script src>`
- `dist/` is the loadable extension — do not reference `public/manifest.json` paths directly when reasoning about the running extension
- Content script and service worker must be IIFE — they cannot use `import` at runtime
- `Readability` is imported from `@mozilla/readability` npm package, not a local file
- `proxy/` is a standalone Node.js server for the podcast feature (separate `package.json`). Binds to `127.0.0.1:3456` only (`HOST`/`PORT` env override) and rejects browser requests whose `Origin` is not `chrome-extension://…` (extra origins via `PROXY_ALLOWED_ORIGINS`); the SW calls it at `http://127.0.0.1:3456`
- **Settings export**: `options/fields.ts` `SECRET_FIELDS` (= `platform/settings.ts` `SECRET_KEYS`) are left out of exports unless the user ticks "include secrets", and an import never clears a secret the file lacks
- Theme CSS uses compound selectors: `[data-theme-name="ocean"][data-theme="dark"]`
- TTS SSE events: `352`=audio chunk, `152`=session finish (may appear twice), `153`=failure
- `vitest.config.js` coverage enforces thresholds (lines 55 / functions 50 / branches 45 / statements 52) — regressing coverage fails `npm run test:coverage`
- **Stop button**: while streaming, the send button becomes Stop; `abortGeneration(tabId)` in `services/stream-handler.ts` disconnects the port AND finalizes directly — a port's own `onDisconnect` never fires for a `disconnect()` it initiated (only the SW end sees it; the SW keys its fetch abort off that). Every end of a stream (done / error / stop / SW gone) goes through the one idempotent `finalize()`
- **Background streams**: switching tabs never clears the outgoing tab's `isGenerating` (write it only via `state.setGeneratingForTab`). After the chat area is rebuilt, `CHAT_RERENDERED` lets the stream handler re-attach the live answer bubble, or show / save the outcome of a stream that ended while the tab was hidden. Restored session state never restores in-flight flags (`isGenerating` / `isPodcastGenerating`)
- **TTS is window-global** ("printer resource"): nothing stops playback except the user (message button / global `#ttsIndicator` chip) or the audio resource being claimed — a new playback (player's takeover point inside `initTTSPlayback`) or a podcast start (`PODCAST_STOP_REQUEST`). Tab switch / `handleLoadChat` / retry-edit only **detach** the button anchor; `CHAT_RERENDERED` re-attaches it by `[data-msg-id]` (assistant bubbles carry ids — live ones from `callAI`, restored ones from `appendMessageFromHistory`). A plain send with autoplay off does NOT stop TTS. See `docs/superpowers/specs/2026-09-26-global-tts-design.md`
- **Page cache vs navigation**: `TabState.pageUrl` records where `pageContent` was extracted; `state.invalidatePageIfNavigated` (wired to `chrome.tabs.onUpdated`) drops the cache when the tab moves to another URL (hash ignored) and notifies `pageInvalidated`
- **Talking to the content script**: use `sendToContentScript()` (`platform/messaging.ts`) — it injects `content.js` and retries when the tab has none (tabs opened before install/update). A failure means the page can't host one (chrome://, Web Store) → show `error.pageUnsupported`
- **Annotation state is per tab**: `features/annotation.ts` keys state by `sender.tab.id` and renders the active tab's on `tabSwitched`
- **Rendering model output**: all Markdown / stored-HTML → DOM goes through `side_panel/ui/markdown.ts` (`renderMarkdown` / `sanitizeHtml`: marked + DOMPurify). Never `marked.parse` → `innerHTML` directly — answers are untrusted (the page is in the prompt). Remote images become links (never fetched), links get `target=_blank rel=noopener noreferrer`, non-http(s)/mailto hrefs are dropped. Inspect untrusted HTML with `parseInertHtml()` (a `<template>`), not a detached `div` — a detached div in the live document still fetches `<img>` sources. Chat history stores assistant **Markdown** (`format: 'md'`), not rendered HTML
- **Message ids**: every `ChatMessage` has an `id` (`shared/ids.ts` `genId`; legacy persisted messages get one on restore via `ensureMessageIds`). User bubbles carry `data-msg-id`; retry / edit truncate history with `truncateHistoryFromId` — content matching (`truncateHistoryFromUserContent`) is only the fallback for id-less legacy bubbles, since it picks the wrong turn when two messages share text
- **User message meta**: user `ChatMessage`s carry `meta` (`rawText` / `displayText` / `quote`) next to the assembled API `content`; `appendUserMessage()` renders bubbles from it for live sends, tab switches, reopen and history loads alike (so retry / edit keep working). `toApiMessage()` strips local fields (`meta`, `hadImages`, `type`) before anything goes to the model
- **IME-safe Enter**: keydown handlers that send on Enter must guard `e.isComposing || e.keyCode === 229` (IME composition, see `ai-chat.ts`) — otherwise Chinese/Japanese input sends mid-composition
- **Layering guardrail**: dependency-cruiser (`.dependency-cruiser.cjs`), not ESLint — see Source Layout. ESLint lints `.ts` through typescript-eslint (syntax-level `recommended` rules; `@typescript-eslint/no-unused-vars` is an error, `_`-prefixed args exempt)
- **Source maps**: inline only in dev/watch builds; `npm run build` ships none (keeps `dist/` ~4x smaller)
- **Image intake**: `services/images.ts` `ingestImages()` is the single entry point for adding images (upload button + paste + drag-drop all funnel through it). The chat model is assumed multimodal: images are always sent as `image_url` parts — there is no OCR fallback and no vision toggle (GLM-OCR and `visionEnabled` were removed; the options page clears the stale keys on save).
- **Sending**: every entry point that sends to the model goes through `submit()` / `services/composer.ts` — never read `userInput.value` or the preview bar directly. A non-empty draft rides along with quick actions / quick commands as extra instructions (`draft.supplement` prompt); suggestion chips only fill the input.
- **History operations**: use `services/chat/history-ops.ts` (`appendMessage`/`rollbackTrailingUserMessage`/`truncateHistoryFromId`) instead of mutating `tabState.conversationHistory` directly — it centralizes persistence + rollback policy.
- **State persistence**: `state.ts` field setters persist to `chrome.storage.session` debounced (250ms); conversation helpers + `persistForTab()` flush immediately, and `switchToTab()` flushes the outgoing tab. Add new TabState fields as explicit getter/setter pairs — the runtime `defineTabField` name-synthesis was removed.
- **SW chat streaming**: every chat call goes through `background/chat-runner.ts` (`streamToPort` for ports, `completeChat` for one-shot JSON calls) → a provider in `background/providers/` (`openai.ts` = OpenAI-compatible SSE via `shared/sse.ts`; `anthropic.ts` = native Messages API via `@anthropic-ai/sdk`, adaptive thinking). `settings.provider` picks it. The runner owns the idle watchdog (`IDLE_TIMEOUT_MS`), `finishReason`, usage accounting (`background/usage.ts` → `storage.local`, F9) and the agent tool loop. `purpose: 'light'` routes to `fastModelName` (suggestions, titles, annotation, translation, quiz).
- **Agent mode (F11, opt-in `agentMode`)**: tools are declared and executed in the **side panel** (`services/agent-tools.ts`, read-only: search / read paragraphs, selection, related pages, reading-history search, open tabs, highlight). The worker streams a `tool_calls` message, waits for the panel's `tool_results`, and loops at most `AGENT_MAX_STEPS` (6) times per turn (`chat-runner.ts`). Provider tool-call formats are normalized to OpenAI-style `tool_calls`.
- **Related Reading / 知识关联** (`features/related-pages.ts`): page records live in **IndexedDB** (`shared/page-records-db.ts`, DB `ai-reader` opened by `shared/db.ts` — v2, stores `pageRecords` / `chats` / `highlights` / `annotations` / `translations`; store `pageRecords`, keyPath `normalizedUrl`; computed via `shared/url-normalize.ts` — strips hash + utm/ref/source/from/gclid/fbclid/spm/share_*, sorts remaining params, lowercases host, drops trailing slash). All record writes (upsert by normalizedUrl + FIFO eviction beyond `embeddingMaxPages`) and cosine-similarity ranking run in the **service worker** (`background/sw-related-pages.ts` + `shared/vector.ts`); the panel only sends one-shot `pageRecords:store` / `pageRecords:findRelated` messages (types in `shared/protocol.ts`). Legacy `chrome.storage.local['pageRecords']` records are migrated to IndexedDB once by the worker (`migrateLegacyPageRecords`, awaited before any store/find). Embedding config (`embeddingApiKey`/`embeddingApiBase`/`embeddingModel`) must be set **independently** in the options page — there is no fallback to the chat provider, and any missing field surfaces as `not-configured` status (one of the panel's seven states: `idle/loading/results/empty/error/disabled/not-configured`). After each successful `pageRecords:store`, the panel auto-refreshes the current URL (debounced 300ms) — no tab switch needed. On failure the panel shows `error` status + a retry button. The options page clears records via `clearPageRecords()` from `shared/page-records-db.ts` (IndexedDB is same-origin across extension contexts).
- **Chat history** lives in IndexedDB `chats` (`shared/chats-db.ts`), not `storage.local`. Chat ids are `chat_<ms>_<random>` — a bare timestamp collided for two saves in one millisecond
- **Page context (F1/F2)**: extraction returns paragraphs (`content/paragraphs.ts`) stored as `TabState.pageParagraphs`; `shared/context-builder.ts` labels them `[#N]` and, over the character budget, keeps the opening paragraphs + BM25-best matches for the question (no more tail truncation). Answers' `[#N]` become citation chips (`ui/citations.ts` → `features/citations.ts`): scroll + flash in the page, seek on YouTube, quote toast on PDFs
- **PDF / YouTube (F3)**: PDF tabs can't host a content script — `services/page-extractor.ts` `readTab()` routes `.pdf` URLs (or a `HEAD` saying `application/pdf`) to `services/pdf-extractor.ts`, which fetches the file and parses it with pdf.js, **lazy-loaded** (`pdf-loader.ts`; pdf.js + worker are separate chunks, never in the main bundle). On YouTube the content script returns the caption track as `[m:ss]`-stamped paragraphs (`content/youtube.ts`, parsing in `shared/youtube.ts`), falling back to Readability when a video has no captions
- **Highlights (F6)** are painted with the CSS Custom Highlight API (`content/highlights.ts`) — no wrapper elements in the page; anchoring is a text-quote selector (`shared/highlights.ts`). Deep-annotation results are cached per normalized URL + text hash (`annotations` store)
- **Context menu / shortcuts (F8)**: `background/sw-menus.ts` calls `sidePanel.open` first (must stay inside the user gesture), then queues the action in `storage.session` + messages an open panel; `features/panel-actions.ts` runs each action id once. Menu labels are inline zh/en (the SW cannot import `i18n.js`) — `sw-menus.ts` is on the prompt guard's CJK allowlist
- **Branches (F10)**: retry / edit keep the old continuation in `TabState.branches` (`chat/history-ops.ts` `branchFromId` / `switchBranch`); never drop history tails directly
- **Podcast direct mode (F13, opt-in `podcastDirect`)**: `background/podcast-direct.ts` opens the Volcengine WebSocket from the worker; a `declarativeNetRequest` **session rule** (id 4201, that URL only, `tabIds: [-1]`) injects the X-Api-* headers and is removed after the session. Failure before any audio → falls back to the proxy. Frames: `shared/podcast-frames.ts`, pinned byte-for-byte to `proxy/server.js` by `tests/proxy/frames-compat.test.js` — change both together
