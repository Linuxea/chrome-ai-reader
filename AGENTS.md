# AGENTS.md

## Build & Run

```bash
npm run dev    # vite build --watch + watch-iife for content/background (development)
npm run build  # vite build && node build-extension.js (production)
npm run test   # vitest run (444 tests across 29 files)
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
- Type definitions: `src/shared/types.ts` (TabState, ChatMessage, ChartInfo, OcrResult)
- Error handling: `src/shared/result.ts` (Result<T,E>, ok(), err())

## Source Layout (`src/`)

5-layer dependency hierarchy in the side panel. Modules export `init*()` functions called bottom-up from `src/side_panel/main.ts`:

| Layer | Directory | Depends on |
|-------|-----------|------------|
| Shared | `src/shared/` | nothing |
| State | `src/side_panel/state.ts` | shared |
| UI | `src/side_panel/ui/` | shared + state |
| Services | `src/side_panel/services/` | shared + state + UI |
| Features | `src/side_panel/features/` | services + UI + state |

**Key sub-modules (services):**
- `page-extractor.ts` — page content extraction (returns `Result<ExtractResult>`)
- `message-sender.ts` — message assembly and sending
- `stream-handler.ts` — SSE streaming + thinking block rendering
- `quick-action-handler.ts` — quick action dispatch
- `ai-chat.ts` — facade re-exporting sub-modules

**Other entry points:**
- `src/content/index.ts` — content script (IIFE-bundled)
- `src/background/service-worker.ts` — background worker (IIFE-bundled)
- `src/options/index.ts` — settings page (bundled by Vite, split into sections/)

## Event System

- `src/side_panel/events.ts` — lightweight synchronous event bus
- `EVENTS` constant enum — all event names are typed constants, no string magic keys
- Events: RETRY, REMOVE_SUGGEST_QUESTIONS, REQUEST_RERENDER, GENERATE_SUGGESTIONS, GENERATE_OUTLINE, CLEAR_QUOTE_PREVIEW, CHART_CLICK, PODCAST_CLICK, ADD_TTS_BUTTON, SAVE_CURRENT_CHAT, RENDER_HISTORY_LIST

## Chrome Extension Messaging

- **Streaming** (AI chat, TTS, suggest questions): `chrome.runtime.connect` with named ports (`ai-chat`, `tts`, `suggest`)
- **One-shot** (page extract, selection relay, model list, OCR): `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage`
- **Config sync**: `chrome.storage.onChanged` listeners — changes apply live without reload

## API Path Convention

`apiBase` does **not** include `/v1`. Endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`.

## i18n

Strings in `src/shared/i18n.js` keyed by dot-notation. DOM auto-translates via `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-title` attributes. Default prompts for built-in quick actions are always Chinese regardless of UI language.

## Testing

- **Vitest** with jsdom environment, 444 tests across 29 files
- Chrome mock: `tests/helpers/chrome-mock.js` (programmable port, storage, tabs)
- Coverage: ~30% overall, core modules 80%+ (dom-helpers 98%, theme 100%, sw-openai 91%, page-extractor 88%)
- Run `npm run test:coverage` for detailed coverage report

## Key Gotchas

- `dist/` is the loadable extension — do not reference `public/manifest.json` paths directly when reasoning about the running extension
- Content script and service worker must be IIFE — they cannot use `import` at runtime
- `Readability` is imported from `@mozilla/readability` npm package, not a local file
- `proxy/` is a standalone Node.js server for the podcast feature (separate `package.json`, runs on `localhost:3456`)
- Theme CSS uses compound selectors: `[data-theme-name="ocean"][data-theme="dark"]`
- TTS SSE events: `352`=audio chunk, `152`=session finish (may appear twice), `153`=failure
- `vitest.config.js` coverage `include` pattern is `src/**/*.js` — most source files are now `.ts`, so coverage numbers may undercount; update pattern when adding TS test files
- `scripts/watch-iife.js` does NOT include the esbuild plugin (unlike `build-extension.js`) — TypeScript in content/background is only transpiled during production build, not in dev watch mode
