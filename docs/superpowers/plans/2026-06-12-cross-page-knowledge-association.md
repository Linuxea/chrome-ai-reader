# 跨页面知识关联 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate embedding vectors for pages users read, compute cosine similarity against history, and show a "Related Reading" panel in the side panel.

**Architecture:** Background service worker handles embedding API calls via a new `embedding` port. Side panel feature module (`related-pages.ts`) manages local storage of page records, similarity computation, and UI rendering. Settings page gets a new collapsible section for embedding configuration.

**Tech Stack:** TypeScript (strict), Chrome Extension APIs, OpenAI-compatible embeddings API, Vitest + jsdom

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Modify | Add `PageRecord`, `PageRelation` interfaces |
| `src/shared/types.js` | Modify | Add JSDoc typedefs for JS consumers |
| `src/shared/i18n.js` | Modify | Add knowledge-association i18n strings (zh + en) |
| `src/background/sw-openai.ts` | Modify | Add `callEmbedding()` function |
| `src/background/service-worker.ts` | Modify | Add `embedding` port handler |
| `src/side_panel/events.ts` | Modify | Add `SHOW_RELATED_PAGES` event |
| `src/side_panel/features/related-pages.ts` | **Create** | Core logic: storage, similarity, UI rendering |
| `src/side_panel/related-pages.css` | **Create** | Panel styling |
| `src/side_panel/index.html` | Modify | Add related-pages panel HTML + CSS link |
| `src/side_panel/main.ts` | Modify | Init related-pages module, wire events |
| `src/options/index.html` | Modify | Add embedding settings section |
| `src/options/embedding-settings.ts` | **Create** | Embedding settings logic |
| `src/options/fields.ts` | Modify | Add embedding fields |
| `src/options/index.ts` | Modify | Init embedding settings, wire save/load |
| `src/options/import-export.ts` | Modify | Include embedding fields in export/import |
| `tests/side_panel/features/related-pages.test.js` | **Create** | Unit tests for related-pages |
| `tests/background/sw-openai.test.js` | Modify | Add embedding API tests |

---

### Task 1: Add PageRecord and PageRelation types

**Files:**
- Modify: `src/shared/types.ts:63-64`
- Modify: `src/shared/types.js:41-42`

- [ ] **Step 1: Add TypeScript interfaces to types.ts**

```typescript
export interface PageRecord {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  embedding: number[];
  timestamp: number;
}

export interface PageRelation {
  record: PageRecord;
  similarity: number;
}
```

- [ ] **Step 2: Add JSDoc typedefs to types.js**

```javascript
/**
 * A stored page record with its embedding vector.
 *
 * @typedef {Object} PageRecord
 * @property {string} id - Unique identifier (crypto.randomUUID)
 * @property {string} url - Page URL
 * @property {string} title - Page title
 * @property {string} excerpt - Short excerpt (max 200 chars)
 * @property {number[]} embedding - Embedding vector
 * @property {number} timestamp - Reading time (Date.now())
 */

/**
 * A page record paired with its similarity score.
 *
 * @typedef {Object} PageRelation
 * @property {PageRecord} record - The related page record
 * @property {number} similarity - Cosine similarity (0-1)
 */
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/shared/types.js
git commit -m "feat: add PageRecord and PageRelation types for knowledge association"
```

---

### Task 2: Add i18n strings for knowledge association

**Files:**
- Modify: `src/shared/i18n.js` (zh and en sections)

- [ ] **Step 1: Add Chinese strings**

Insert into the `zh` object (before the closing `}` of `zh`):

```javascript
'settings.embedding': '知识关联',
'settings.embedding.toggle': '启用知识关联',
'settings.embedding.apiKey': 'Embedding API Key',
'settings.embedding.apiKey.ph': '留空则复用大模型 API Key',
'settings.embedding.apiKey.hint': '用于生成页面内容向量。留空则自动使用上方大模型配置的 API Key。',
'settings.embedding.apiBase': 'Embedding API 地址',
'settings.embedding.apiBase.ph': 'https://ark.cn-beijing.volces.com/api/coding/v3',
'settings.embedding.apiBase.hint': '留空则复用大模型 API 地址。',
'settings.embedding.model': 'Embedding 模型',
'settings.embedding.model.ph': 'doubao-embedding-vision',
'settings.embedding.model.hint': '支持 OpenAI 兼容的 embeddings 接口的模型。',
'settings.embedding.threshold': '相似度阈值',
'settings.embedding.maxPages': '最大存储页数',
'settings.embedding.clearAll': '清除所有页面记录',
'settings.embedding.clearAll.confirm': '确定要清除所有页面记录吗？此操作不可撤销。',
'settings.embedding.cleared': '已清除所有页面记录',
'related.title': '相关阅读',
'related.empty': '暂无相关页面',
'related.similarity': '相似度',
'related.daysAgo': '{n}天前',
'related.hoursAgo': '{n}小时前',
'related.justNow': '刚刚',
'related.weekAgo': '1周前',
'related.weeksAgo': '{n}周前',
```

- [ ] **Step 2: Add English strings**

Insert into the `en` object:

```javascript
'settings.embedding': 'Knowledge Association',
'settings.embedding.toggle': 'Enable knowledge association',
'settings.embedding.apiKey': 'Embedding API Key',
'settings.embedding.apiKey.ph': 'Leave empty to reuse LLM API Key',
'settings.embedding.apiKey.hint': 'Used to generate page content vectors. Leave empty to use the LLM API Key above.',
'settings.embedding.apiBase': 'Embedding API Base',
'settings.embedding.apiBase.ph': 'https://ark.cn-beijing.volces.com/api/coding/v3',
'settings.embedding.apiBase.hint': 'Leave empty to reuse the LLM API Base.',
'settings.embedding.model': 'Embedding Model',
'settings.embedding.model.ph': 'doubao-embedding-vision',
'settings.embedding.model.hint': 'A model supporting OpenAI-compatible embeddings API.',
'settings.embedding.threshold': 'Similarity threshold',
'settings.embedding.maxPages': 'Max stored pages',
'settings.embedding.clearAll': 'Clear all page records',
'settings.embedding.clearAll.confirm': 'Are you sure you want to clear all page records? This cannot be undone.',
'settings.embedding.cleared': 'All page records cleared',
'related.title': 'Related Reading',
'related.empty': 'No related pages yet',
'related.similarity': 'Similarity',
'related.daysAgo': '{n} days ago',
'related.hoursAgo': '{n} hours ago',
'related.justNow': 'Just now',
'related.weekAgo': '1 week ago',
'related.weeksAgo': '{n} weeks ago',
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node -c src/shared/i18n.js`
Expected: No output (success)

- [ ] **Step 4: Commit**

```bash
git add src/shared/i18n.js
git commit -m "feat: add i18n strings for knowledge association feature"
```

---

### Task 3: Add callEmbedding() to sw-openai.ts

**Files:**
- Modify: `src/background/sw-openai.ts:75`

- [ ] **Step 1: Add callEmbedding function**

Append after line 75 (after `callSuggestQuestions` closing brace):

```typescript
export async function callEmbedding(text: string, port: chrome.runtime.Port): Promise<void> {
  const { embeddingApiKey, embeddingApiBase, embeddingModel, apiKey, apiBase } = await chrome.storage.sync.get([
    'embeddingApiKey', 'embeddingApiBase', 'embeddingModel', 'apiKey', 'apiBase',
  ]) as { embeddingApiKey?: string; embeddingApiBase?: string; embeddingModel?: string; apiKey?: string; apiBase?: string };

  const key = embeddingApiKey || apiKey;
  if (!key) { safePostMessage(port, { type: 'error', error: 'No API key configured for embedding' }); return; }

  const baseUrl = embeddingApiBase || apiBase || 'https://ark.cn-beijing.volces.com/api/coding/v3';
  const model = embeddingModel || 'doubao-embedding-vision';

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error((errorData as Record<string, { message?: string }>).error?.message || `Embedding API request failed (${response.status})`);
    }

    const data = await response.json() as { data?: { embedding: number[] }[] };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      safePostMessage(port, { type: 'error', error: 'Empty embedding returned' });
      return;
    }
    safePostMessage(port, { type: 'embedding', embedding });
  } catch (e: unknown) {
    safePostMessage(port, { type: 'error', error: (e as Error).message });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/background/sw-openai.ts
git commit -m "feat: add callEmbedding() for page vector generation"
```

---

### Task 4: Add embedding port to service-worker.ts

**Files:**
- Modify: `src/background/service-worker.ts:1,35`

- [ ] **Step 1: Import callEmbedding**

Change line 1 from:
```typescript
import { callOpenAI, callSuggestQuestions } from './sw-openai';
```
to:
```typescript
import { callOpenAI, callSuggestQuestions, callEmbedding } from './sw-openai';
```

- [ ] **Step 2: Add embedding port handler**

Insert after line 35 (after the `podcast-audio` block, before the closing `});`):

```typescript
  } else if (port.name === 'embedding') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'embed') await callEmbedding(msg.text as string, port);
    });
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat: add embedding port handler in service worker"
```

---

### Task 5: Add SHOW_RELATED_PAGES event

**Files:**
- Modify: `src/side_panel/events.ts:16,33`

- [ ] **Step 1: Add event constant**

Add after line 16 (`RENDER_HISTORY_LIST`):
```typescript
  SHOW_RELATED_PAGES: 'showRelatedPages',
```

- [ ] **Step 2: Add event type to EventMap**

Add after line 33 (`RENDER_HISTORY_LIST`):
```typescript
  [EVENTS.SHOW_RELATED_PAGES]: () => void;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/side_panel/events.ts
git commit -m "feat: add SHOW_RELATED_PAGES event"
```

---

### Task 6: Create related-pages.ts feature module

**Files:**
- Create: `src/side_panel/features/related-pages.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * Related Pages feature — manages page records with embedding vectors,
 * computes cosine similarity, and renders the "Related Reading" panel.
 *
 * Flow:
 *   1. extractPageContent() triggers requestEmbedding() with page excerpt
 *   2. requestEmbedding() calls background via chrome.runtime.connect('embedding')
 *   3. On response, storePageRecord() saves to chrome.storage.local
 *   4. On tab switch / page load, showRelatedPages() computes top-5 and renders UI
 */

import type { PageRecord, PageRelation } from '../../shared/types';
import { t } from '../../shared/i18n.js';
import { emit, EVENTS } from '../events';

const STORAGE_KEY = 'pageRecords';
const MAX_RECORDS_DEFAULT = 200;
const THRESHOLD_DEFAULT = 0.70;
const MIN_CONTENT_LENGTH = 100;
const MAX_EXCERPT_LENGTH = 200;

let panelEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let badgeEl: HTMLElement | null = null;
let hasNewRelations = false;

// --- Storage ---

async function getPageRecords(): Promise<PageRecord[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as PageRecord[]) || [];
}

async function savePageRecords(records: PageRecord[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: records });
}

// --- Cosine Similarity ---

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function magnitude(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

// --- Embedding Request ---

export async function requestEmbedding(text: string, url: string, title: string): Promise<void> {
  if (!text || text.length < MIN_CONTENT_LENGTH) return;

  const { embeddingEnabled } = await chrome.storage.sync.get('embeddingEnabled');
  if (embeddingEnabled === false) return;

  const port = chrome.runtime.connect({ name: 'embedding' });

  return new Promise((resolve) => {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'embedding') {
        const embedding = msg.embedding as number[];
        if (embedding && embedding.length > 0) {
          await storePageRecord({ url, title, excerpt: text.slice(0, MAX_EXCERPT_LENGTH), embedding });
        }
        port.disconnect();
        resolve();
      } else if (msg.type === 'error') {
        await handleEmbeddingError();
        port.disconnect();
        resolve();
      }
    });

    port.onDisconnect.addListener(() => resolve());
    port.postMessage({ type: 'embed', text: text.slice(0, MAX_EXCERPT_LENGTH) });
  });
}

// --- Error Handling ---

const FAILURE_KEY = 'embeddingFailures';
const PAUSE_KEY = 'embeddingPausedUntil';
const MAX_CONSECUTIVE_FAILURES = 3;
const PAUSE_DURATION_MS = 60 * 60 * 1000; // 1 hour

async function handleEmbeddingError(): Promise<void> {
  const data = await chrome.storage.local.get([FAILURE_KEY, PAUSE_KEY]);
  const failures = ((data[FAILURE_KEY] as number) || 0) + 1;
  await chrome.storage.local.set({ [FAILURE_KEY]: failures });

  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    await chrome.storage.local.set({ [PAUSE_KEY]: Date.now() + PAUSE_DURATION });
  }
}

async function isEmbeddingPaused(): Promise<boolean> {
  const data = await chrome.storage.local.get(PAUSE_KEY);
  const pausedUntil = data[PAUSE_KEY] as number | undefined;
  if (!pausedUntil) return false;
  if (Date.now() >= pausedUntil) {
    await chrome.storage.local.remove([PAUSE_KEY, FAILURE_KEY]);
    return false;
  }
  return true;
}

// --- Store Page Record ---

async function storePageRecord(record: Omit<PageRecord, 'id' | 'timestamp'>): Promise<void> {
  const records = await getPageRecords();

  // Update existing record for same URL
  const existingIdx = records.findIndex(r => r.url === record.url);
  if (existingIdx >= 0) {
    records[existingIdx] = { ...records[existingIdx], ...record, timestamp: Date.now() };
  } else {
    records.push({ ...record, id: crypto.randomUUID(), timestamp: Date.now() });
  }

  // FIFO cleanup
  const { embeddingMaxPages } = await chrome.storage.sync.get('embeddingMaxPages');
  const maxPages = (embeddingMaxPages as number) || MAX_RECORDS_DEFAULT;
  while (records.length > maxPages) records.shift();

  await savePageRecords(records);
  hasNewRelations = true;
  updateBadge();
}

// --- Find Related Pages ---

export async function findRelatedPages(currentUrl: string): Promise<PageRelation[]> {
  const records = await getPageRecords();
  const currentRecord = records.find(r => r.url === currentUrl);
  if (!currentRecord || !currentRecord.embedding?.length) return [];

  const { embeddingThreshold } = await chrome.storage.sync.get('embeddingThreshold');
  const threshold = (embeddingThreshold as number) || THRESHOLD_DEFAULT;

  const relations: PageRelation[] = [];
  for (const record of records) {
    if (record.url === currentUrl || !record.embedding?.length) continue;
    const similarity = cosineSimilarity(currentRecord.embedding, record.embedding);
    if (similarity >= threshold) relations.push({ record, similarity });
  }

  relations.sort((a, b) => b.similarity - a.similarity);
  return relations.slice(0, 5);
}

// --- Time Formatting ---

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return t('related.justNow');
  if (hours < 24) return t('related.hoursAgo', { n: hours });
  if (days === 1) return t('related.daysAgo', { n: 1 });
  if (days < 7) return t('related.daysAgo', { n: days });
  if (days < 14) return t('related.weekAgo');
  return t('related.weeksAgo', { n: Math.floor(days / 7) });
}

// --- UI Rendering ---

function updateBadge(): void {
  if (!badgeEl) return;
  if (hasNewRelations) {
    badgeEl.classList.remove('hidden');
  } else {
    badgeEl.classList.add('hidden');
  }
}

export async function renderRelatedPages(currentUrl: string): Promise<void> {
  if (!listEl) return;

  const relations = await findRelatedPages(currentUrl);
  hasNewRelations = false;
  updateBadge();

  if (relations.length === 0) {
    listEl.innerHTML = `<div class="related-empty">${t('related.empty')}</div>`;
    return;
  }

  listEl.innerHTML = relations.map(r => `
    <div class="related-item" data-url="${escapeHtml(r.record.url)}">
      <div class="related-item-title">${escapeHtml(r.record.title || r.record.url)}</div>
      <div class="related-item-meta">
        <span class="related-similarity">${t('related.similarity')} ${Math.round(r.similarity * 100)}%</span>
        <span class="related-time">· ${formatTimeAgo(r.record.timestamp)}</span>
      </div>
      <div class="related-item-excerpt">${escapeHtml(r.record.excerpt.slice(0, 100))}</div>
    </div>
  `).join('');

  // Click handlers
  listEl.querySelectorAll('.related-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = (item as HTMLElement).dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Clear All ---

export async function clearAllPageRecords(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
  if (listEl) listEl.innerHTML = `<div class="related-empty">${t('related.empty')}</div>`;
}

// --- Initialization ---

export interface RelatedPagesDeps {
  chatArea: HTMLElement;
}

export function initRelatedPages(deps: RelatedPagesDeps): void {
  // Create panel DOM
  panelEl = document.createElement('div');
  panelEl.id = 'relatedPagesPanel';
  panelEl.className = 'related-panel';
  panelEl.innerHTML = `
    <div class="related-header">
      <span class="related-header-title">
        <span class="related-badge hidden"></span>
        ${t('related.title')}
      </span>
      <button class="related-toggle" title="${t('related.title')}">▲</button>
    </div>
    <div class="related-list" id="relatedList">
      <div class="related-empty">${t('related.empty')}</div>
    </div>
  `;

  // Insert after chat area
  deps.chatArea.insertAdjacentElement('afterend', panelEl);

  listEl = panelEl.querySelector('#relatedList');
  badgeEl = panelEl.querySelector('.related-badge');

  // Toggle collapse
  const toggleBtn = panelEl.querySelector('.related-toggle') as HTMLButtonElement;
  const listContainer = panelEl.querySelector('.related-list') as HTMLElement;
  toggleBtn.addEventListener('click', () => {
    const collapsed = listContainer.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '▼' : '▲';
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/features/related-pages.ts
git commit -m "feat: add related-pages feature module with embedding, similarity, and UI"
```

---

### Task 7: Create related-pages.css

**Files:**
- Create: `src/side_panel/related-pages.css`

- [ ] **Step 1: Write the CSS**

```css
/* Related Reading Panel */

.related-panel {
  border-top: 1px solid var(--border);
  background: var(--card-bg);
  flex-shrink: 0;
}

.related-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  cursor: default;
  user-select: none;
}

.related-header-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.related-badge {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e74c3c;
  flex-shrink: 0;
}

.related-badge.hidden {
  display: none;
}

.related-toggle {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
}

.related-toggle:hover {
  background: var(--hover-bg);
}

.related-list {
  max-height: 240px;
  overflow-y: auto;
  transition: max-height 0.2s ease;
}

.related-list.collapsed {
  max-height: 0;
  overflow: hidden;
}

.related-empty {
  padding: 12px 16px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
}

.related-item {
  padding: 8px 16px;
  cursor: pointer;
  border-top: 1px solid var(--border);
  transition: background 0.15s;
}

.related-item:hover {
  background: var(--hover-bg);
}

.related-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.related-item-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.related-similarity {
  color: var(--accent);
  font-weight: 500;
}

.related-item-excerpt {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/side_panel/related-pages.css
git commit -m "feat: add related-pages panel styles"
```

---

### Task 8: Wire related-pages into main.ts

**Files:**
- Modify: `src/side_panel/main.ts:1,17,71,82,97`

- [ ] **Step 1: Add import**

Add after line 17 (`import { initChartAnalyzer, handleChartClick } from './features/chart-analyzer';`):
```typescript
import { initRelatedPages, renderRelatedPages } from './features/related-pages';
```

- [ ] **Step 2: Add init call**

Add after line 71 (`initChartAnalyzer({ chatArea: els.chatArea });`):
```typescript
  initRelatedPages({ chatArea: els.chatArea });
```

- [ ] **Step 3: Add event handler**

Add after line 82 (`on(EVENTS.SAVE_CURRENT_CHAT, () => saveCurrentChat());`):
```typescript
  on(EVENTS.SHOW_RELATED_PAGES, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) renderRelatedPages(tabs[0].url);
    });
  });
```

- [ ] **Step 4: Trigger related pages on init**

After the `if` block at line 102 (before the closing `}` of `init()`), add:

```typescript
  // Show related pages for current tab on init
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) renderRelatedPages(tabs[0].url);
  });
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/side_panel/main.ts
git commit -m "feat: wire related-pages into side panel main"
```

---

### Task 9: Add related-pages panel HTML + CSS link to index.html

**Files:**
- Modify: `src/side_panel/index.html:14`

- [ ] **Step 1: Add CSS link**

Add after line 14 (`<link rel="stylesheet" href="chart-analyzer.css">`):
```html
  <link rel="stylesheet" href="related-pages.css">
```

- [ ] **Step 2: Commit**

```bash
git add src/side_panel/index.html
git commit -m "feat: add related-pages CSS link to side panel"
```

---

### Task 10: Add embedding settings to options page

**Files:**
- Create: `src/options/embedding-settings.ts`
- Modify: `src/options/index.html` (add HTML section)
- Modify: `src/options/fields.ts` (add embedding fields)
- Modify: `src/options/index.ts` (init + wire save/load)
- Modify: `src/options/import-export.ts` (include in export/import)

- [ ] **Step 1: Create embedding-settings.ts**

```typescript
import { t } from '../shared/i18n.js';
import { showStatus } from './status';
import { clearAllPageRecords } from '../side_panel/features/related-pages.js';

const embeddingEnabledCheckbox = document.getElementById('embeddingEnabled') as HTMLInputElement;
const embeddingApiKeyInput = document.getElementById('embeddingApiKey') as HTMLInputElement;
const embeddingApiBaseInput = document.getElementById('embeddingApiBase') as HTMLInputElement;
const embeddingModelInput = document.getElementById('embeddingModel') as HTMLInputElement;
const embeddingThresholdInput = document.getElementById('embeddingThreshold') as HTMLInputElement;
const embeddingThresholdValue = document.getElementById('embeddingThresholdValue') as HTMLSpanElement;
const embeddingMaxPagesInput = document.getElementById('embeddingMaxPages') as HTMLInputElement;
const clearEmbeddingBtn = document.getElementById('clearEmbeddingBtn') as HTMLButtonElement;

export function initEmbeddingSettings(): void {
  embeddingThresholdInput.addEventListener('input', () => {
    embeddingThresholdValue.textContent = `${embeddingThresholdInput.value}%`;
  });

  clearEmbeddingBtn.addEventListener('click', () => {
    if (!confirm(t('settings.embedding.clearAll.confirm'))) return;
    clearAllPageRecords().then(() => {
      showStatus(t('settings.embedding.cleared'), 'success');
    });
  });
}

export function loadEmbeddingValues(data: Record<string, unknown>): void {
  if (data.embeddingEnabled !== undefined) embeddingEnabledCheckbox.checked = data.embeddingEnabled as boolean;
  if (data.embeddingApiKey) embeddingApiKeyInput.value = data.embeddingApiKey as string;
  if (data.embeddingApiBase) embeddingApiBaseInput.value = data.embeddingApiBase as string;
  if (data.embeddingModel) embeddingModelInput.value = data.embeddingModel as string;
  if (data.embeddingThreshold) {
    embeddingThresholdInput.value = String(Math.round((data.embeddingThreshold as number) * 100));
    embeddingThresholdValue.textContent = `${Math.round((data.embeddingThreshold as number) * 100)}%`;
  }
  if (data.embeddingMaxPages) embeddingMaxPagesInput.value = String(data.embeddingMaxPages);
}

export function collectEmbeddingSaveData(): { set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];

  set.embeddingEnabled = embeddingEnabledCheckbox.checked;

  const apiKey = embeddingApiKeyInput.value.trim();
  if (apiKey) set.embeddingApiKey = apiKey; else remove.push('embeddingApiKey');

  const apiBase = embeddingApiBaseInput.value.trim();
  if (apiBase) set.embeddingApiBase = apiBase; else remove.push('embeddingApiBase');

  const model = embeddingModelInput.value.trim();
  if (model) set.embeddingModel = model; else remove.push('embeddingModel');

  set.embeddingThreshold = parseInt(embeddingThresholdInput.value, 10) / 100;
  set.embeddingMaxPages = parseInt(embeddingMaxPagesInput.value, 10) || 200;

  return { set, remove };
}
```

- [ ] **Step 2: Add HTML section to index.html**

Insert before `<!-- 推荐追问 -->` section (before line 137):

```html
      <!-- 知识关联 -->
      <details class="config-details">
        <summary class="config-summary" data-i18n="settings.embedding">知识关联</summary>
        <div class="config-fields">
          <label class="toggle-row">
            <span data-i18n="settings.embedding.toggle">启用知识关联</span>
            <input type="checkbox" id="embeddingEnabled" checked>
          </label>
          <div class="form-group">
            <label for="embeddingApiKey" data-i18n="settings.embedding.apiKey">Embedding API Key</label>
            <input type="password" id="embeddingApiKey" data-i18n-placeholder="settings.embedding.apiKey.ph" placeholder="留空则复用大模型 API Key" autocomplete="off">
            <p class="hint" data-i18n="settings.embedding.apiKey.hint">用于生成页面内容向量。留空则自动使用上方大模型配置的 API Key。</p>
          </div>
          <div class="form-group">
            <label for="embeddingApiBase" data-i18n="settings.embedding.apiBase">Embedding API 地址</label>
            <input type="text" id="embeddingApiBase" data-i18n-placeholder="settings.embedding.apiBase.ph" placeholder="https://ark.cn-beijing.volces.com/api/coding/v3">
            <p class="hint" data-i18n="settings.embedding.apiBase.hint">留空则复用大模型 API 地址。</p>
          </div>
          <div class="form-group">
            <label for="embeddingModel" data-i18n="settings.embedding.model">Embedding 模型</label>
            <input type="text" id="embeddingModel" data-i18n-placeholder="settings.embedding.model.ph" placeholder="doubao-embedding-vision">
            <p class="hint" data-i18n="settings.embedding.model.hint">支持 OpenAI 兼容的 embeddings 接口的模型。</p>
          </div>
          <div class="form-group">
            <label for="embeddingThreshold" data-i18n="settings.embedding.threshold">相似度阈值</label>
            <div class="range-row">
              <input type="range" id="embeddingThreshold" min="50" max="95" value="70" step="5">
              <span id="embeddingThresholdValue">70%</span>
            </div>
          </div>
          <div class="form-group">
            <label for="embeddingMaxPages" data-i18n="settings.embedding.maxPages">最大存储页数</label>
            <input type="number" id="embeddingMaxPages" min="10" max="500" value="200">
          </div>
          <button id="clearEmbeddingBtn" class="danger-btn" type="button" data-i18n="settings.embedding.clearAll">清除所有页面记录</button>
        </div>
      </details>
```

- [ ] **Step 3: Update fields.ts**

Add to `textFields`:
```typescript
  embeddingApiKey: document.getElementById('embeddingApiKey') as HTMLInputElement,
  embeddingApiBase: document.getElementById('embeddingApiBase') as HTMLInputElement,
  embeddingModel: document.getElementById('embeddingModel') as HTMLInputElement,
```

Add to `checkboxFields`:
```typescript
  embeddingEnabled: document.getElementById('embeddingEnabled') as HTMLInputElement,
```

Add to `SYNC_FIELDS`:
```typescript
  'embeddingEnabled', 'embeddingApiKey', 'embeddingApiBase', 'embeddingModel', 'embeddingThreshold', 'embeddingMaxPages',
```

- [ ] **Step 4: Update options/index.ts**

Add import:
```typescript
import { initEmbeddingSettings, loadEmbeddingValues, collectEmbeddingSaveData } from './embedding-settings';
```

Add init call after `initSuggestSettings();`:
```typescript
initEmbeddingSettings();
```

Add load call in the `chrome.storage.sync.get` callback:
```typescript
  loadEmbeddingValues(data as Record<string, unknown>);
```

Add collect call in save handler:
```typescript
  const embedding = collectEmbeddingSaveData();
```

Add embedding data to the save object and removals:
```typescript
  const toRemove = [...(llm.remove || []), ...(tts.remove || []), ...(ocr.remove || []), ...(embedding.remove || [])];
  const data = { ...(llm.set || {}), ...tts.set, ...ocr.set, ...suggest.set, ...embedding.set };
```

- [ ] **Step 5: Update import-export.ts**

Add `embeddingApiKey`, `embeddingApiBase`, `embeddingModel` to the text fields that are included in export/import. Since these are already in `textFields` (from Step 3), they'll be automatically included in the export loop and import loop. No code changes needed — verify by checking that `textFields` includes them.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/options/embedding-settings.ts src/options/index.html src/options/fields.ts src/options/index.ts
git commit -m "feat: add embedding settings to options page"
```

---

### Task 11: Trigger embedding after page content extraction

**Files:**
- Modify: `src/side_panel/services/page-extractor.ts:33`

- [ ] **Step 1: Add embedding trigger after extraction**

Add import at top of `page-extractor.ts` (after line 3):
```typescript
import { requestEmbedding } from '../features/related-pages';
```

After line 33 (`return ok(response.data!);`):
```typescript
  // Trigger embedding in background after a delay (avoid rapid tab switches wasting calls)
  if (response.data) {
    setTimeout(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.url) {
        requestEmbedding(response.data!.excerpt, tabs[0].url, response.data!.title);
      }
    }, 3000);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/side_panel/services/page-extractor.ts
git commit -m "feat: trigger embedding after page content extraction"
```

---

### Task 12: Write tests

**Files:**
- Create: `tests/side_panel/features/related-pages.test.js`
- Modify: `tests/background/sw-openai.test.js`

- [ ] **Step 1: Write related-pages unit tests**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome APIs
vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    },
  },
  runtime: {
    connect: vi.fn(() => ({
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    })),
  },
  tabs: {
    create: vi.fn(),
  },
});

import { cosineSimilarity } from '../../../src/side_panel/features/related-pages.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 5);
  });

  it('returns ~0.85 for typical similar vectors', () => {
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.15, 0.25, 0.35, 0.45];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.99); // nearly identical direction
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for different length vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('handles negative values', () => {
    const a = [-0.5, 0.3, -0.2];
    const b = [-0.4, 0.4, -0.1];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/side_panel/features/related-pages.test.js`
Expected: All tests pass

- [ ] **Step 3: Add embedding API tests to sw-openai.test.js**

Append to the end of the file:

```javascript
import { callEmbedding } from '../../src/background/sw-openai.js';

describe('callEmbedding', () => {
  let port;

  beforeEach(() => {
    vi.clearAllMocks();
    port = createMockPort();
    store.sync = {
      apiKey: 'sk-test',
      apiBase: 'https://api.test.com',
      embeddingApiKey: '',
      embeddingApiBase: '',
      embeddingModel: '',
    };
  });

  it('sends embedding request and returns vector', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
      })
    );

    await callEmbedding('test text', port);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test.com/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Authorization': 'Bearer sk-test' }),
        body: expect.stringContaining('test text'),
      })
    );
    expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'embedding', embedding: mockEmbedding });
  });

  it('uses embedding-specific config when provided', async () => {
    store.sync.embeddingApiKey = 'emb-key';
    store.sync.embeddingApiBase = 'https://emb.test.com';
    store.sync.embeddingModel = 'custom-emb';

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: [0.5] }] }),
      })
    );

    await callEmbedding('test', port);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://emb.test.com/embeddings',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Authorization': 'Bearer emb-key' }),
        body: expect.stringContaining('custom-emb'),
      })
    );
  });

  it('sends error when no API key configured', async () => {
    store.sync.apiKey = '';
    await callEmbedding('test', port);
    expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', error: 'No API key configured for embedding' });
  });

  it('sends error on API failure', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
      })
    );

    await callEmbedding('test', port);
    expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', error: 'Unauthorized' });
  });

  it('sends error on empty embedding', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: [] }] }),
      })
    );

    await callEmbedding('test', port);
    expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', error: 'Empty embedding returned' });
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: All 444+ tests pass (should be ~460+ with new tests)

- [ ] **Step 5: Commit**

```bash
git add tests/side_panel/features/related-pages.test.js tests/background/sw-openai.test.js
git commit -m "test: add tests for related-pages and embedding API"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: Build succeeds, `dist/` contains all files

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final verification and cleanup for knowledge association"
```

---

## Changelog — 2026-06 Refactor (相关阅读 v2)

This section documents the comprehensive refactor triggered by persistent
"panel always empty" reports. Root causes were multiple silent-failure paths
that compounded into an unusable feature.

### Bugs fixed

1. **Configuration fallback mismatch (root cause)** — `callEmbedding` fell
   back to `apiKey`/`apiBase` from the chat config when embedding-specific
   fields were missing, but kept the hardcoded default model
   `doubao-embedding-vision` and base URL
   `https://ark.cn-beijing.volces.com/api/coding/v3`. The result was
   cross-provider requests (e.g. DeepSeek key + volcano base) that always
   401'd, or DeepSeek base + doubao model that always 400'd. **Fix:**
   embedding config is now strictly independent; missing fields surface as
   `error.embeddingNotConfigured`.
2. **Silent error swallowing** — background returned `errorKey` but the
   feature discarded it; users saw "no related pages" instead of the actual
   error. **Fix:** errors now drive UI state `error` + show the i18n message.
3. **Circuit breaker silenced everything** — 3 consecutive failures paused
   the feature for 1 hour with no UI feedback. **Fix:** breaker removed
   entirely; every request runs, errors are shown immediately.
4. **No auto-refresh after indexing** — `storePageRecord` only updated the
   badge; the panel never re-rendered, so the user had to switch tabs to see
   results. **Fix:** debounced (300ms) `renderRelatedPages` call after each
   successful store.
5. **URL not normalized** — same page under `?utm_source=...` or `#anchor`
   produced duplicate records and caused `findRelatedPages` to miss the
   current page's own embedding → empty result. **Fix:** new
   `shared/url-normalize.ts`; records keyed by `normalizedUrl`.
6. **First-visit deadlock** — `findRelatedPages` required the current URL to
   already have an embedding; combined with bug #4 the panel appeared dead.
   **Fix:** auto-refresh after store breaks the deadlock.

### Architecture changes

- Feature now goes through `platform/ports.ts` (`openEmbeddingPort`) and
  `platform/storage.ts` (`getSync`/`getLocal`/`setLocal`) instead of calling
  `chrome.*` directly.
- Wire contract uses `shared/protocol.ts` types (`EmbeddingRequest`,
  `EmbeddingResponse`, `EmbeddingErrorMessage`) instead of
  `Record<string, unknown>` + manual casts.
- `service-worker.ts` port dispatcher uses `PORT_NAMES.EMBEDDING` instead
  of the string `'embedding'`.
- Panel has a typed state machine
  (`idle|loading|results|empty|error|disabled|not-configured`) driving
  rendering, replacing the previous binary "list / empty" rendering.
- `PAGE_EXTRACTED` debounce lowered from 3000ms to 1500ms for faster
  perceived response.
- `dropLegacyRecords()` runs once at `initRelatedPages()` to clean
  pre-`normalizedUrl` records (clean rebuild policy per user decision).

### Options page changes

- Embedding API Key / Base / Model inputs are now `required`.
- Hints/placeholders updated to reflect independent configuration
  (no more "leave empty to reuse LLM API key").
- `collectEmbeddingSaveData` blocks save when `embeddingEnabled=true` but
  any of the three fields is missing, surfacing
  `status.embeddingConfigIncomplete`.

### Test coverage

- `tests/shared/url-normalize.test.ts` (10 cases) — hash, utm, sorting,
  host case, root path, invalid input.
- `tests/side_panel/features/related-pages.test.js` (34 cases, up from 17)
  — added: state machine for all 6 user-visible statuses, init DOM test,
  auto-refresh both branches, error surfacing, URL dedup, legacy drop,
  click-through.
- `tests/background/sw-openai.test.js` `callEmbedding` block rewritten —
  removed fallback cases, added per-field `error.embeddingNotConfigured`
  cases, explicit "does not fall back to chat config" regression guard.

### Verification

- `npm run test` — 857 passing (28 new).
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
