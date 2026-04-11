# AGENTS.md

## Build & Run

```bash
npm run dev    # vite build --watch (development)
npm run build  # vite build && node build-extension.js (production)
```

No tests, no linter, no typecheck configured.

## Build Architecture (non-obvious)

Two-phase build — Chrome cannot use ES modules for content scripts or service workers:

1. **Vite** (`vite.config.js`) — bundles `src/side_panel/index.html` and `src/options/index.html` as entry points. Output: `dist/` with chunked JS in `dist/assets/`.
2. **Rollup IIFE** (`build-extension.js`) — bundles `src/content/index.js` → `dist/content.js` and `src/background/service-worker.js` → `dist/background.js` as self-contained IIFE scripts.
3. **Static copy** — `public/` copied verbatim to `dist/` (manifest, icons).

Load the **`dist/`** directory in `chrome://extensions/`, not the project root.

## Source Layout (`src/`)

5-layer dependency hierarchy in the side panel. Modules export `init*()` functions called bottom-up from `src/side_panel/main.js`:

| Layer | Directory | Depends on |
|-------|-----------|------------|
| Shared | `src/shared/` | nothing |
| State | `src/side_panel/state.js` | shared |
| UI | `src/side_panel/ui/` | shared + state |
| Services | `src/side_panel/services/` | shared + state + UI |
| Features | `src/side_panel/features/` | services + UI + state |

**Other entry points:**
- `src/content/index.js` — content script (IIFE-bundled)
- `src/background/service-worker.js` — background worker (IIFE-bundled)
- `src/options/index.js` — settings page (bundled by Vite)

## Chrome Extension Messaging

- **Streaming** (AI chat, TTS, suggest questions): `chrome.runtime.connect` with named ports (`ai-chat`, `tts`, `suggest`)
- **One-shot** (page extract, selection relay, model list, OCR): `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage`
- **Config sync**: `chrome.storage.onChanged` listeners — changes apply live without reload

## API Path Convention

`apiBase` does **not** include `/v1`. Endpoints are `{apiBase}/chat/completions` and `{apiBase}/models`.

## i18n

Strings in `src/shared/i18n.js` keyed by dot-notation. DOM auto-translates via `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-title` attributes. Default prompts for built-in quick actions are always Chinese regardless of UI language.

## Key Gotchas

- `dist/` is the loadable extension — do not reference `public/manifest.json` paths directly when reasoning about the running extension
- Content script and service worker must be IIFE — they cannot use `import` at runtime
- `Readability` is imported from `@mozilla/readability` npm package, not a local file
- `proxy/` is a standalone Node.js server for the podcast feature (separate `package.json`, runs on `localhost:3456`)
- Theme CSS uses compound selectors: `[data-theme-name="ocean"][data-theme="dark"]`
- TTS SSE events: `352`=audio chunk, `152`=session finish (may appear twice), `153`=failure
