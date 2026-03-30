# Multi-Theme System Design

**Date:** 2026-03-30
**Status:** Approved

## Overview

Expand the current binary dark/light toggle into a multi-theme system with three self-contained themes, each providing its own light and dark color palette.

## Themes

| Name | ID | Mood | Primary (Light) | Primary (Dark) |
|------|----|------|------------------|----------------|
| 素笺 | `sujian` | Warm paper, current default | `#c07842` (warm brown) | `#dba06a` (golden) |
| 海洋 | `ocean` | Cool blue, calm, professional | `#3a7bd5` (blue) | `#5a9cf0` (sky blue) |
| 森林 | `forest` | Natural green, fresh, organic | `#5a8a50` (green) | `#7db87a` (lime green) |

Each theme defines a complete set of CSS custom properties for both light and dark variants.

## Data Model

**Storage keys in `chrome.storage.sync`:**

- `themeName: string` — `"sujian"` (default), `"ocean"`, or `"forest"`
- `darkMode: boolean` — unchanged, toggles light/dark within the chosen theme

The two preferences are orthogonal: switching themes preserves the light/dark mode.

**Migration:** On first load after update, if `themeName` is absent, default to `"sujian"`. The existing `darkMode` key continues to work unchanged.

## CSS Architecture

Two HTML attributes on `<html>`:
- `data-theme-name="sujian|ocean|forest"` — which palette
- `data-theme="light|dark"` — light or dark variant (existing, unchanged values)

Each CSS file defines theme blocks using compound attribute selectors:

```css
/* 素笺 light (also the :root default) */
:root,
[data-theme-name="sujian"] {
  --bg: #f5f0e8;
  --card-bg: #fffdf8;
  /* ... full variable set ... */
}

/* 素笺 dark */
[data-theme-name="sujian"][data-theme="dark"] {
  --bg: #171412;
  /* ... full dark variable set ... */
}

/* 海洋 light */
[data-theme-name="ocean"] {
  --bg: #e8f0f8;
  /* ... ... */
}

/* 海洋 dark */
[data-theme-name="ocean"][data-theme="dark"] {
  --bg: #1a2332;
  /* ... ... */
}

/* 森林 light */
[data-theme-name="forest"] {
  --bg: #f0f4ec;
  /* ... ... */
}

/* 森林 dark */
[data-theme-name="forest"][data-theme="dark"] {
  --bg: #1a1e18;
  /* ... ... */
}
```

Scattered `[data-theme="dark"]` selectors in `history.css` and `quick-commands.css` must be updated to compound selectors (e.g., `[data-theme-name="sujian"][data-theme="dark"]` or made theme-agnostic via CSS variables).

## Settings Page UI

New section "外观主题" as a collapsible `<details>` panel at the top of settings, above "大模型配置":

```
▸ 外观主题
  [● 素笺 ✓] [● 海洋] [● 森林]
```

- Three compact cards in a row, each with a color dot + theme name
- Active card gets the theme's primary color border + checkmark
- Clicking a card immediately saves to `chrome.storage.sync` and applies the theme
- The moon/sun toggle in the page header remains unchanged (controls dark mode)

## Files Changed

| File | Change |
|------|--------|
| `side_panel/side_panel.css` | Add ocean + forest variable blocks (light + dark). Update `:root` to include `[data-theme-name="sujian"]` selector. Update `[data-theme="dark"]` to compound selectors. |
| `options/options.css` | Same theme variable additions. Add styles for the theme picker cards (`.theme-picker`, `.theme-card`, `.theme-card.active`). |
| `side_panel/history.css` | Update `[data-theme="dark"]` overrides to work with compound selectors. |
| `side_panel/quick-commands.css` | Same. |
| `side_panel/side_panel.js` | Update `applyTheme()` to also set `data-theme-name` attribute. Read `themeName` from storage on init. Listen for `themeName` changes via `chrome.storage.onChanged`. |
| `options/options.js` | Same `applyTheme()` update. Add theme picker card rendering, click handling, and active state. Add `themeName` to `SYNC_FIELDS` for export/import. |
| `options/options.html` | Add "外观主题" collapsible section with theme picker markup above "大模型配置". |

## Color Palettes

### Ocean (海洋) — Light

```
--bg: #e8f0f8
--card-bg: #f4f8fc
--text: #1a2a3a
--text-secondary: #7a8a9a
--primary: #3a7bd5
--primary-light: #eaf1fa
--primary-hover: #2e6bc0
--border: #c8d8e8
--user-bg: #3a7bd5
--user-text: #f4f8fc
--ai-bg: #f4f8fc
--ai-text: #1a2a3a
--shadow: 0 2px 8px rgba(58, 123, 213, 0.08)
--error-bg: #fef0f0
--error-text: #c44536
--error-border: #f0d4d0
--thinking-bg: #f0f4fa
--thinking-border: #c8d8e8
--hover-overlay: rgba(58, 123, 213, 0.06)
```

### Ocean (海洋) — Dark

```
--bg: #121a26
--card-bg: #1a2332
--text: #d0dae8
--text-secondary: #8a9aaa
--primary: #5a9cf0
--primary-light: #1a2a3e
--primary-hover: #4a8ce0
--border: #2a3a4e
--user-bg: #5a9cf0
--user-text: #121a26
--ai-bg: #1a2332
--ai-text: #d0dae8
--shadow: 0 2px 8px rgba(0, 0, 0, 0.3)
--error-bg: #2a1614
--error-text: #e87060
--error-border: #4a2822
--thinking-bg: #162030
--thinking-border: #2a3a4e
--hover-overlay: rgba(90, 156, 240, 0.08)
```

### Forest (森林) — Light

```
--bg: #f0f4ec
--card-bg: #f8faf6
--text: #1a2418
--text-secondary: #7a8a72
--primary: #5a8a50
--primary-light: #eaf2e8
--primary-hover: #4a7a40
--border: #c8d8c0
--user-bg: #5a8a50
--user-text: #f8faf6
--ai-bg: #f8faf6
--ai-text: #1a2418
--shadow: 0 2px 8px rgba(90, 138, 80, 0.08)
--error-bg: #fef0ee
--error-text: #c44536
--error-border: #f0d4d0
--thinking-bg: #f0f4ee
--thinking-border: #c8d8c0
--hover-overlay: rgba(90, 138, 80, 0.06)
```

### Forest (森林) — Dark

```
--bg: #141812
--card-bg: #1e221a
--text: #d0dac8
--text-secondary: #8a9a82
--primary: #7db87a
--primary-light: #1e2a1a
--primary-hover: #6da86a
--border: #2e3e28
--user-bg: #7db87a
--user-text: #141812
--ai-bg: #1e221a
--ai-text: #d0dac8
--shadow: 0 2px 8px rgba(0, 0, 0, 0.3)
--error-bg: #2a1614
--error-text: #e87060
--error-border: #4a2822
--thinking-bg: #1a2018
--thinking-border: #2e3e28
--hover-overlay: rgba(125, 184, 122, 0.08)
```

## Export/Import

`themeName` is added to the `SYNC_FIELDS` array so it's included in backup/restore JSON. On import, the theme is applied immediately.

## No-Go

- No custom/user-created themes — only the three built-in presets
- No system preference detection for dark/light mode — manual toggle only
- No theme picker in the side panel header — settings page only
- No animation/transition when switching themes (instant swap)
