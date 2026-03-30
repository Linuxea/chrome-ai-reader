# Multi-Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ocean and Forest themes alongside the existing 素笺 theme, with a color swatch card picker in the settings page.

**Architecture:** Each theme is a self-contained CSS variable palette with light+dark variants. Two HTML attributes (`data-theme-name` + `data-theme`) control theme and mode independently. Settings page gets a new "外观主题" section with clickable swatch cards.

**Tech Stack:** Vanilla CSS custom properties, vanilla JS, Chrome storage sync API. No build system.

---

### Task 1: Update side_panel.css theme variable blocks

**Files:**
- Modify: `side_panel/side_panel.css`

This is the largest change. Replace the `:root` and `[data-theme="dark"]` blocks with theme-aware selectors, add Ocean and Forest palettes, and fix hardcoded focus-ring rgba values.

- [ ] **Step 1: Replace `:root` block with sujian light selector**

In `side_panel/side_panel.css`, replace lines 9–29 (the `:root { ... }` block) with:

```css
:root,
[data-theme-name="sujian"] {
  --bg: #f5f0e8;
  --card-bg: #fffdf8;
  --text: #2d2a26;
  --text-secondary: #9a9084;
  --primary: #c07842;
  --primary-light: #f7efe5;
  --border: #e3dbd0;
  --user-bg: #c07842;
  --user-text: #fffdf8;
  --ai-bg: #fffdf8;
  --ai-text: #2d2a26;
  --shadow: 0 2px 8px rgba(120, 100, 80, 0.08);
  --error-bg: #fdf0ee;
  --error-text: #c44536;
  --error-border: #f0d4d0;
  --thinking-bg: #f9f5ef;
  --thinking-border: #e3dbd0;
  --primary-hover: #a86535;
  --hover-overlay: rgba(120, 100, 80, 0.06);
  --focus-ring: rgba(192, 120, 66, 0.1);
  --quote-bubble-border: rgba(255, 253, 248, 0.4);
  --quote-bubble-text: rgba(255, 253, 248, 0.75);
}
```

Note: `:root` stays for initial load (before JS sets `data-theme-name`). Added three new variables: `--focus-ring`, `--quote-bubble-border`, `--quote-bubble-text`.

- [ ] **Step 2: Replace `[data-theme="dark"]` block with sujian dark compound selector**

Replace lines 31–51 (`[data-theme="dark"] { ... }`) with:

```css
[data-theme-name="sujian"][data-theme="dark"] {
  --bg: #171412;
  --card-bg: #221e1a;
  --text: #e3dbd0;
  --text-secondary: #9e9285;
  --primary: #dba06a;
  --primary-light: #2d2519;
  --border: #3a332b;
  --user-bg: #dba06a;
  --user-text: #171412;
  --ai-bg: #221e1a;
  --ai-text: #e3dbd0;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  --error-bg: #2a1614;
  --error-text: #e87060;
  --error-border: #4a2822;
  --thinking-bg: #1e1a16;
  --thinking-border: #3a332b;
  --primary-hover: #c88f5e;
  --hover-overlay: rgba(219, 160, 106, 0.08);
  --focus-ring: rgba(219, 160, 106, 0.08);
  --quote-bubble-border: rgba(23, 20, 18, 0.4);
  --quote-bubble-text: rgba(23, 20, 18, 0.75);
}
```

- [ ] **Step 3: Add Ocean light block**

Insert after the sujian dark block:

```css
/* 海洋 — Ocean */
[data-theme-name="ocean"] {
  --bg: #e8f0f8;
  --card-bg: #f4f8fc;
  --text: #1a2a3a;
  --text-secondary: #7a8a9a;
  --primary: #3a7bd5;
  --primary-light: #eaf1fa;
  --border: #c8d8e8;
  --user-bg: #3a7bd5;
  --user-text: #f4f8fc;
  --ai-bg: #f4f8fc;
  --ai-text: #1a2a3a;
  --shadow: 0 2px 8px rgba(58, 123, 213, 0.08);
  --error-bg: #fef0f0;
  --error-text: #c44536;
  --error-border: #f0d4d0;
  --thinking-bg: #f0f4fa;
  --thinking-border: #c8d8e8;
  --primary-hover: #2e6bc0;
  --hover-overlay: rgba(58, 123, 213, 0.06);
  --focus-ring: rgba(58, 123, 213, 0.1);
  --quote-bubble-border: rgba(244, 248, 252, 0.4);
  --quote-bubble-text: rgba(244, 248, 252, 0.75);
}
```

- [ ] **Step 4: Add Ocean dark block**

```css
[data-theme-name="ocean"][data-theme="dark"] {
  --bg: #121a26;
  --card-bg: #1a2332;
  --text: #d0dae8;
  --text-secondary: #8a9aaa;
  --primary: #5a9cf0;
  --primary-light: #1a2a3e;
  --border: #2a3a4e;
  --user-bg: #5a9cf0;
  --user-text: #121a26;
  --ai-bg: #1a2332;
  --ai-text: #d0dae8;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  --error-bg: #2a1614;
  --error-text: #e87060;
  --error-border: #4a2822;
  --thinking-bg: #162030;
  --thinking-border: #2a3a4e;
  --primary-hover: #4a8ce0;
  --hover-overlay: rgba(90, 156, 240, 0.08);
  --focus-ring: rgba(90, 156, 240, 0.08);
  --quote-bubble-border: rgba(18, 26, 38, 0.4);
  --quote-bubble-text: rgba(18, 26, 38, 0.75);
}
```

- [ ] **Step 5: Add Forest light block**

```css
/* 森林 — Forest */
[data-theme-name="forest"] {
  --bg: #f0f4ec;
  --card-bg: #f8faf6;
  --text: #1a2418;
  --text-secondary: #7a8a72;
  --primary: #5a8a50;
  --primary-light: #eaf2e8;
  --border: #c8d8c0;
  --user-bg: #5a8a50;
  --user-text: #f8faf6;
  --ai-bg: #f8faf6;
  --ai-text: #1a2418;
  --shadow: 0 2px 8px rgba(90, 138, 80, 0.08);
  --error-bg: #fef0ee;
  --error-text: #c44536;
  --error-border: #f0d4d0;
  --thinking-bg: #f0f4ee;
  --thinking-border: #c8d8c0;
  --primary-hover: #4a7a40;
  --hover-overlay: rgba(90, 138, 80, 0.06);
  --focus-ring: rgba(90, 138, 80, 0.1);
  --quote-bubble-border: rgba(248, 250, 246, 0.4);
  --quote-bubble-text: rgba(248, 250, 246, 0.75);
}
```

- [ ] **Step 6: Add Forest dark block**

```css
[data-theme-name="forest"][data-theme="dark"] {
  --bg: #141812;
  --card-bg: #1e221a;
  --text: #d0dac8;
  --text-secondary: #8a9a82;
  --primary: #7db87a;
  --primary-light: #1e2a1a;
  --border: #2e3e28;
  --user-bg: #7db87a;
  --user-text: #141812;
  --ai-bg: #1e221a;
  --ai-text: #d0dac8;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  --error-bg: #2a1614;
  --error-text: #e87060;
  --error-border: #4a2822;
  --thinking-bg: #1a2018;
  --thinking-border: #2e3e28;
  --primary-hover: #6da86a;
  --hover-overlay: rgba(125, 184, 122, 0.08);
  --focus-ring: rgba(125, 184, 122, 0.08);
  --quote-bubble-border: rgba(20, 24, 18, 0.4);
  --quote-bubble-text: rgba(20, 24, 18, 0.75);
}
```

- [ ] **Step 7: Replace hardcoded focus-ring in `.input-wrapper:focus-within`**

Find the existing sujian-only dark override (around line 382):

```css
.input-wrapper:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(192, 120, 66, 0.1);
}
```

Replace with:

```css
.input-wrapper:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
```

Then **delete** the separate dark-mode override block (the `[data-theme="dark"] .input-wrapper:focus-within` block that follows it).

- [ ] **Step 8: Replace hardcoded quote-in-bubble rgba values**

Find:

```css
.quote-in-bubble {
  border-left: 3px solid rgba(255, 253, 248, 0.4);
  padding-left: 8px;
  margin-bottom: 6px;
  color: rgba(255, 253, 248, 0.75);
  font-size: 13px;
}
```

Replace with:

```css
.quote-in-bubble {
  border-left: 3px solid var(--quote-bubble-border);
  padding-left: 8px;
  margin-bottom: 6px;
  color: var(--quote-bubble-text);
  font-size: 13px;
}
```

- [ ] **Step 9: Commit**

```bash
git add side_panel/side_panel.css
git commit -m "feat(css): add ocean + forest theme palettes to side_panel.css"
```

---

### Task 2: Update options.css theme variable blocks + theme picker styles

**Files:**
- Modify: `options/options.css`

- [ ] **Step 1: Replace `:root` block with sujian light selector**

In `options/options.css`, replace lines 9–29 (the `:root { ... }` block) with:

```css
:root,
[data-theme-name="sujian"] {
  --bg: #f5f0e8;
  --card-bg: #fffdf8;
  --text: #2d2a26;
  --text-secondary: #9a9084;
  --text-label: #3d3630;
  --primary: #c07842;
  --primary-hover: #a86535;
  --primary-light: #f7efe5;
  --border: #e3dbd0;
  --input-bg: #fffdf8;
  --summary-bg: #f9f5ef;
  --summary-hover-bg: #f2ebe2;
  --refresh-bg: #f5f0e8;
  --refresh-hover-bg: #ebe5da;
  --toggle-off: #d4cdc3;
  --shadow: 0 2px 12px rgba(120, 100, 80, 0.08);
  --success: #5a8a50;
  --error: #c44536;
  --import-hover-bg: #f7efe5;
  --focus-ring: rgba(192, 120, 66, 0.1);
}
```

- [ ] **Step 2: Replace `[data-theme="dark"]` block with sujian dark compound selector**

Replace lines 31–51 (`[data-theme="dark"] { ... }`) with:

```css
[data-theme-name="sujian"][data-theme="dark"] {
  --bg: #171412;
  --card-bg: #221e1a;
  --text: #e3dbd0;
  --text-secondary: #9e9285;
  --text-label: #d4cdc3;
  --primary: #dba06a;
  --primary-hover: #c88f5e;
  --primary-light: #2d2519;
  --border: #3a332b;
  --input-bg: #221e1a;
  --summary-bg: #1e1a16;
  --summary-hover-bg: #282320;
  --refresh-bg: #2d2519;
  --refresh-hover-bg: #3a332b;
  --toggle-off: #4a4138;
  --shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  --success: #7db87a;
  --error: #e87060;
  --import-hover-bg: #2d2519;
  --focus-ring: rgba(219, 160, 106, 0.08);
}
```

- [ ] **Step 3: Add Ocean light block**

```css
/* 海洋 — Ocean */
[data-theme-name="ocean"] {
  --bg: #e8f0f8;
  --card-bg: #f4f8fc;
  --text: #1a2a3a;
  --text-secondary: #7a8a9a;
  --text-label: #2a3a4a;
  --primary: #3a7bd5;
  --primary-hover: #2e6bc0;
  --primary-light: #eaf1fa;
  --border: #c8d8e8;
  --input-bg: #f4f8fc;
  --summary-bg: #eaf1fa;
  --summary-hover-bg: #dce8f4;
  --refresh-bg: #e8f0f8;
  --refresh-hover-bg: #dae6f2;
  --toggle-off: #b0c0d0;
  --shadow: 0 2px 12px rgba(58, 123, 213, 0.08);
  --success: #5a8a50;
  --error: #c44536;
  --import-hover-bg: #eaf1fa;
  --focus-ring: rgba(58, 123, 213, 0.1);
}
```

- [ ] **Step 4: Add Ocean dark block**

```css
[data-theme-name="ocean"][data-theme="dark"] {
  --bg: #121a26;
  --card-bg: #1a2332;
  --text: #d0dae8;
  --text-secondary: #8a9aaa;
  --text-label: #b0c0d0;
  --primary: #5a9cf0;
  --primary-hover: #4a8ce0;
  --primary-light: #1a2a3e;
  --border: #2a3a4e;
  --input-bg: #1a2332;
  --summary-bg: #152030;
  --summary-hover-bg: #1e2a3a;
  --refresh-bg: #1a2a3e;
  --refresh-hover-bg: #2a3a4e;
  --toggle-off: #3a4a5a;
  --shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  --success: #7db87a;
  --error: #e87060;
  --import-hover-bg: #1a2a3e;
  --focus-ring: rgba(90, 156, 240, 0.08);
}
```

- [ ] **Step 5: Add Forest light block**

```css
/* 森林 — Forest */
[data-theme-name="forest"] {
  --bg: #f0f4ec;
  --card-bg: #f8faf6;
  --text: #1a2418;
  --text-secondary: #7a8a72;
  --text-label: #2a3a20;
  --primary: #5a8a50;
  --primary-hover: #4a7a40;
  --primary-light: #eaf2e8;
  --border: #c8d8c0;
  --input-bg: #f8faf6;
  --summary-bg: #eaf2e8;
  --summary-hover-bg: #dce8d8;
  --refresh-bg: #f0f4ec;
  --refresh-hover-bg: #e2e8dc;
  --toggle-off: #a0b098;
  --shadow: 0 2px 12px rgba(90, 138, 80, 0.08);
  --success: #5a8a50;
  --error: #c44536;
  --import-hover-bg: #eaf2e8;
  --focus-ring: rgba(90, 138, 80, 0.1);
}
```

- [ ] **Step 6: Add Forest dark block**

```css
[data-theme-name="forest"][data-theme="dark"] {
  --bg: #141812;
  --card-bg: #1e221a;
  --text: #d0dac8;
  --text-secondary: #8a9a82;
  --text-label: #b0c0a8;
  --primary: #7db87a;
  --primary-hover: #6da86a;
  --primary-light: #1e2a1a;
  --border: #2e3e28;
  --input-bg: #1e221a;
  --summary-bg: #1a2018;
  --summary-hover-bg: #242a20;
  --refresh-bg: #1e2a1a;
  --refresh-hover-bg: #2e3e28;
  --toggle-off: #3a4a38;
  --shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  --success: #7db87a;
  --error: #e87060;
  --import-hover-bg: #1e2a1a;
  --focus-ring: rgba(125, 184, 122, 0.08);
}
```

- [ ] **Step 7: Replace hardcoded focus-ring rgba in input/textarea focus styles**

Find the `input:focus, textarea:focus` block (around line 163–166):

```css
input:focus,
textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(192, 120, 66, 0.1);
}
```

Replace with:

```css
input:focus,
textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
```

Then **delete** the separate dark-mode override block that follows it (`[data-theme="dark"] input:focus, [data-theme="dark"] textarea:focus`).

- [ ] **Step 8: Add theme picker card styles**

Append at the end of `options/options.css`:

```css
/* Theme Picker Cards */
.theme-picker {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.theme-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 2px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  background: var(--input-bg);
  transition: all 0.2s ease;
  font-family: inherit;
  font-size: 13px;
  color: var(--text);
}

.theme-card:hover {
  border-color: var(--primary);
}

.theme-card.active {
  border-color: var(--primary);
  background: var(--primary-light);
}

.theme-card-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex-shrink: 0;
}

.theme-card-check {
  margin-left: auto;
  color: var(--primary);
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.theme-card.active .theme-card-check {
  opacity: 1;
}
```

- [ ] **Step 9: Commit**

```bash
git add options/options.css
git commit -m "feat(css): add ocean + forest theme palettes and picker styles to options.css"
```

---

### Task 3: Update side_panel.js — applyTheme reads themeName

**Files:**
- Modify: `side_panel/side_panel.js` (lines 100–133)

- [ ] **Step 1: Update `applyTheme()` to also set `data-theme-name`**

Find the `applyTheme` function (around line 102–113):

```javascript
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const moonIcon = themeToggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = themeToggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}
```

Replace with:

```javascript
function applyTheme(dark, themeName) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  const moonIcon = themeToggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = themeToggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}
```

- [ ] **Step 2: Update storage init to read `themeName`**

Find the init block (around line 116–118):

```javascript
chrome.storage.sync.get(['darkMode'], (data) => {
  applyTheme(!!data.darkMode);
});
```

Replace with:

```javascript
chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
  applyTheme(!!data.darkMode, data.themeName || 'sujian');
});
```

- [ ] **Step 3: Update storage change listener to also handle `themeName`**

Find the listener (around line 129–133):

```javascript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.darkMode) {
    applyTheme(!!changes.darkMode.newValue);
  }
});
```

Replace with:

```javascript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    const darkMode = changes.darkMode;
    const themeName = changes.themeName;
    if (darkMode || themeName) {
      const isDark = darkMode ? !!darkMode.newValue : document.documentElement.getAttribute('data-theme') === 'dark';
      const currentTheme = themeName ? themeName.newValue : document.documentElement.getAttribute('data-theme-name') || 'sujian';
      applyTheme(isDark, currentTheme);
    }
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add side_panel/side_panel.js
git commit -m "feat(js): update side_panel applyTheme to support themeName"
```

---

### Task 4: Add theme picker to options page (HTML + JS)

**Files:**
- Modify: `options/options.html` (add theme picker section)
- Modify: `options/options.js` (update applyTheme, add picker logic, update export/import)

- [ ] **Step 1: Add theme picker section to options.html**

In `options/options.html`, insert a new `<details>` block **before** the "大模型配置" `<details>` (before line 34):

```html
      <!-- 外观主题 -->
      <details class="config-details">
        <summary class="config-summary">外观主题</summary>
        <div class="config-fields">
          <div class="theme-picker" id="themePicker">
            <button class="theme-card active" data-theme="sujian" type="button">
              <span class="theme-card-dot" style="background:#c07842"></span>
              <span>素笺</span>
              <span class="theme-card-check">✓</span>
            </button>
            <button class="theme-card" data-theme="ocean" type="button">
              <span class="theme-card-dot" style="background:#3a7bd5"></span>
              <span>海洋</span>
              <span class="theme-card-check">✓</span>
            </button>
            <button class="theme-card" data-theme="forest" type="button">
              <span class="theme-card-dot" style="background:#5a8a50"></span>
              <span>森林</span>
              <span class="theme-card-check">✓</span>
            </button>
          </div>
        </div>
      </details>
```

- [ ] **Step 2: Update `applyTheme()` in options.js**

In `options/options.js`, find the `applyTheme` function (lines 6–17):

```javascript
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const moonIcon = themeToggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = themeToggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}
```

Replace with:

```javascript
function applyTheme(dark, themeName) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  const moonIcon = themeToggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = themeToggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}
```

- [ ] **Step 3: Update storage init in options.js**

Find the init block (lines 19–21):

```javascript
chrome.storage.sync.get(['darkMode'], (data) => {
  applyTheme(!!data.darkMode);
});
```

Replace with:

```javascript
chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
  const themeName = data.themeName || 'sujian';
  applyTheme(!!data.darkMode, themeName);
  updateThemePicker(themeName);
});
```

- [ ] **Step 4: Update storage change listener in options.js**

Find the listener (lines 30–34):

```javascript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.darkMode) {
    applyTheme(!!changes.darkMode.newValue);
  }
});
```

Replace with:

```javascript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.darkMode || changes.themeName) {
      const isDark = changes.darkMode ? !!changes.darkMode.newValue : document.documentElement.getAttribute('data-theme') === 'dark';
      const currentTheme = changes.themeName ? changes.themeName.newValue : document.documentElement.getAttribute('data-theme-name') || 'sujian';
      applyTheme(isDark, currentTheme);
      if (changes.themeName) updateThemePicker(changes.themeName.newValue);
    }
  }
});
```

- [ ] **Step 5: Add theme picker logic and updateThemePicker function**

Add this after the `chrome.storage.onChanged` listener block (after line 34, before the apiKeyInput line):

```javascript
// === 外观主题 ===
const themePicker = document.getElementById('themePicker');

function updateThemePicker(themeName) {
  themePicker.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === (themeName || 'sujian'));
  });
}

themePicker.addEventListener('click', (e) => {
  const card = e.target.closest('.theme-card');
  if (!card) return;
  const themeName = card.dataset.theme;
  chrome.storage.sync.set({ themeName });
  // applyTheme will be called by storage.onChanged listener
});
```

- [ ] **Step 6: Add `themeName` to SYNC_FIELDS for export/import**

Find the SYNC_FIELDS definition (line 75):

```javascript
const SYNC_FIELDS = [...Object.keys(textFields), ...Object.keys(checkboxFields)];
```

Replace with:

```javascript
const SYNC_FIELDS = [...Object.keys(textFields), ...Object.keys(checkboxFields), 'themeName'];
```

- [ ] **Step 7: Commit**

```bash
git add options/options.html options/options.js
git commit -m "feat(settings): add theme picker UI and wire up themeName storage"
```

---

### Task 5: Verify and final commit

- [ ] **Step 1: Manual test checklist**

Reload the extension in `chrome://extensions/` and verify:

1. Side panel loads with default 素笺 theme (warm brown) — light mode
2. Dark mode toggle works — switches to sujian dark palette
3. Open settings page → same theme/dark state
4. Settings page shows "外观主题" section with 3 color swatch cards
5. 素笺 card is active (border + checkmark)
6. Click 海洋 card → both settings and side panel switch to blue palette immediately
7. Dark mode toggle still works within Ocean theme
8. Click 森林 card → both switch to green palette
9. Switch back to 素笺 → original warm brown returns
10. Export settings → JSON includes `themeName`
11. Import settings with different `themeName` → theme changes

- [ ] **Step 2: Update CLAUDE.md if needed**

If the architecture section of CLAUDE.md references the old `darkMode` boolean as the only theme mechanism, update it to mention `themeName` and the multi-theme system. Specifically:
- In the "Dark mode (夜间模式)" section, add a note about `themeName` storage key
- Update the storage section to list `themeName` in `chrome.storage.sync` fields

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with multi-theme architecture notes"
```
