/**
 * Related Pages feature — renders the "Related Reading" panel.
 *
 * Flow:
 *   1. extractPageContent() emits PAGE_EXTRACTED → requestEmbedding()
 *   2. requestEmbedding() calls background via openEmbeddingPort()
 *   3. On response, storePageRecord() sends the record to the service
 *      worker (pageRecords:store), which upserts it into IndexedDB and
 *      applies FIFO eviction — then schedules a debounced
 *      renderRelatedPages() so the panel reflects the new entry without
 *      requiring a tab switch.
 *   4. On tab switch / page load, renderRelatedPages() asks the worker
 *      (pageRecords:findRelated) for the top-5 relations — cosine
 *      similarity is computed in the worker — and renders UI.
 *      Status (loading/error/disabled/not-configured) is derived from
 *      current config + last request outcome.
 *
 * Refactor notes (2026-08):
 *   - Records moved from chrome.storage.local (10MB quota, whole-array
 *     JSON read/write per upsert) to IndexedDB keyed by normalizedUrl
 *     (shared/page-records-db.ts); all writes + ranking run in the service
 *     worker (sw-related-pages.ts) via one-shot messages.
 *   - Legacy storage.local records are migrated once by the worker.
 *
 * Earlier notes (2026-06):
 *   - URL normalization prevents duplicate records + missing self-match
 *     when the same page is visited with tracking params or a hash.
 *   - The circuit breaker (FAILURE_KEY / PAUSE_KEY) was removed: every
 *     request now runs and any error is surfaced to the UI as `status:'error'`.
 *   - Embedding config no longer falls back to the chat provider; if the
 *     three embedding_* fields are missing, the panel shows `not-configured`.
 */

import type { PageRecord, PageRelation } from '../../shared/types';
import type {
  EmbeddingRequest, EmbeddingResponse,
  PageRecordsStoreMessage, PageRecordsStoreResponse,
  PageRecordsFindRelatedMessage, PageRecordsFindRelatedResponse,
} from '../../shared/protocol';
import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants';
import { clearPageRecords } from '../../shared/page-records-db';
import { normalizeUrl } from '../../shared/url-normalize';
import { on, EVENTS } from '../events';
import { openEmbeddingPort } from '../../platform/ports';
import { getSync } from '../../platform/storage';
import { openOptionsPage, sendMessage } from '../../platform/messaging';

const MAX_RECORDS_DEFAULT = 200;
const THRESHOLD_DEFAULT = 0.7;
const MIN_CONTENT_LENGTH = 100;
const MAX_EXCERPT_LENGTH = 200;
/** Debounce window for auto-refresh after storePageRecord(). */
const REFRESH_DEBOUNCE_MS = 300;

// --- Panel state -----------------------------------------------------------

export type RelatedStatus =
  | 'idle' // initial / unknown
  | 'loading' // request in flight
  | 'results' // list shown
  | 'empty' // request succeeded, nothing matched
  | 'error' // last request failed (errorKey/errorMessage set)
  | 'disabled' // embeddingEnabled === false
  | 'not-configured'; // one of embeddingApiKey/Base/Model missing

interface RelatedPagesState {
  status: RelatedStatus;
  errorKey?: string;
  errorMessage?: string;
  hasNewRelations: boolean;
}

const state: RelatedPagesState = {
  status: 'idle',
  hasNewRelations: false,
};

/** Reset state — primarily for tests. */
export function resetState(): void {
  state.status = 'idle';
  state.errorKey = undefined;
  state.errorMessage = undefined;
  state.hasNewRelations = false;
}

let panelEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let badgeEl: HTMLElement | null = null;
let lastRenderedUrl = '';
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// --- Embedding configuration probe ----------------------------------------

interface EmbeddingConfig {
  enabled: boolean;
  apiKey?: string;
  apiBase?: string;
  model?: string;
  threshold: number;
  maxPages: number;
}

async function loadEmbeddingConfig(): Promise<EmbeddingConfig> {
  const cfg = await getSync<Record<string, unknown>>([
    'embeddingEnabled',
    'embeddingApiKey',
    'embeddingApiBase',
    'embeddingModel',
    'embeddingThreshold',
    'embeddingMaxPages',
  ]);
  return {
    // enabled defaults to true (matches the checkbox default) — the UI still
    // surfaces a `not-configured` status when the three required fields are
    // missing, so "enabled" just gates the whole feature.
    enabled: cfg.embeddingEnabled !== false,
    apiKey: cfg.embeddingApiKey as string | undefined,
    apiBase: cfg.embeddingApiBase as string | undefined,
    model: cfg.embeddingModel as string | undefined,
    threshold: typeof cfg.embeddingThreshold === 'number' ? (cfg.embeddingThreshold as number) : THRESHOLD_DEFAULT,
    maxPages: typeof cfg.embeddingMaxPages === 'number' ? (cfg.embeddingMaxPages as number) : MAX_RECORDS_DEFAULT,
  };
}

// --- Embedding Request -----------------------------------------------------

export async function requestEmbedding(text: string, url: string, title: string): Promise<void> {
  if (!text || text.length < MIN_CONTENT_LENGTH) return;

  const cfg = await loadEmbeddingConfig();
  if (!cfg.enabled) return;

  // Silently skip when not fully configured — the panel already shows
  // `not-configured` status via renderRelatedPages(); no need to also
  // spam errors on every page extraction.
  if (!cfg.apiKey || !cfg.apiBase || !cfg.model) return;

  const port = openEmbeddingPort();
  const normalized = normalizeUrl(url);

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        try { port.disconnect(); } catch { /* already disconnected */ }
        resolve();
      }
    };

    port.onMessage.addListener(async (msg: EmbeddingResponse) => {
      if (msg.type === 'embedding') {
        const embedding = msg.embedding;
        if (embedding && embedding.length > 0) {
          await storePageRecord({
            url,
            normalizedUrl: normalized,
            title,
            excerpt: text.slice(0, MAX_EXCERPT_LENGTH),
            embedding,
          });
        }
        finish();
      } else if (msg.type === 'error') {
        // Surface the error to the UI so the user can see why the panel is
        // empty instead of silently swallowing it.
        state.status = 'error';
        state.errorKey = msg.errorKey;
        state.errorMessage = msg.error;
        renderState();
        finish();
      }
    });

    port.onDisconnect.addListener(() => finish());

    const req: EmbeddingRequest = { type: 'embed', text: text.slice(0, MAX_EXCERPT_LENGTH) };
    port.postMessage(req);
  });
}

// --- Store Page Record (via service worker) --------------------------------

async function storePageRecord(record: Omit<PageRecord, 'id' | 'timestamp'>): Promise<void> {
  const cfg = await loadEmbeddingConfig();
  const req: PageRecordsStoreMessage = { action: 'pageRecords:store', record, maxPages: cfg.maxPages };
  const res = await sendMessage(req) as PageRecordsStoreResponse | undefined;
  if (!res?.success) throw new Error(res?.error || 'pageRecords:store failed');

  state.hasNewRelations = true;
  updateBadge();

  // Auto-refresh the panel so the user sees the result without having to
  // switch tabs. Debounced so a burst of extractions doesn't thrash the DOM.
  // Note: we refresh the CURRENTLY displayed URL (lastRenderedUrl), not the
  // stored record's URL — the new record may be similar to whatever page the
  // user is currently viewing, so the list must be recomputed either way.
  // This also ensures the badge clears promptly instead of staying lit.
  scheduleAutoRefresh();
}

function scheduleAutoRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (lastRenderedUrl) {
      void renderRelatedPagesByNormalized(lastRenderedUrl);
    }
  }, REFRESH_DEBOUNCE_MS);
}

// --- Find Related Pages (ranked in the service worker) ---------------------

export async function findRelatedPages(currentNormalizedUrl: string): Promise<PageRelation[]> {
  // Idempotent: callers (renderRelatedPages) already normalize, but direct
  // callers (tests, future code) might not. normalizeUrl is stable so this
  // is safe to call on already-normalized input.
  const target = normalizeUrl(currentNormalizedUrl);
  const cfg = await loadEmbeddingConfig();

  const req: PageRecordsFindRelatedMessage = {
    action: 'pageRecords:findRelated',
    normalizedUrl: target,
    threshold: cfg.threshold,
    limit: 5,
  };
  const res = await sendMessage(req) as PageRecordsFindRelatedResponse | undefined;
  if (!res?.success) throw new Error(res?.error || 'pageRecords:findRelated failed');
  return res.relations ?? [];
}

// --- Time Formatting -------------------------------------------------------

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return t('related.justNow');
  if (minutes < 60) return t('related.minutesAgo', { n: minutes });
  if (hours < 24) return t('related.hoursAgo', { n: hours });
  if (days < 7) return t('related.daysAgo', { n: days });
  if (days < 14) return t('related.weekAgo');
  return t('related.weeksAgo', { n: Math.floor(days / 7) });
}

// --- UI Rendering ----------------------------------------------------------

function updateBadge(): void {
  if (!badgeEl) return;
  if (state.hasNewRelations) {
    badgeEl.classList.remove('hidden');
  } else {
    badgeEl.classList.add('hidden');
  }
}

function setState(next: Partial<RelatedPagesState>): void {
  Object.assign(state, next);
  renderState();
}

function renderState(): void {
  if (!listEl) return;
  switch (state.status) {
    case 'disabled':
      listEl.innerHTML = stateMessageHTML(t('related.disabled'), '');
      break;
    case 'not-configured':
      listEl.innerHTML = `
        <div class="related-state related-state--warn">
          <div class="related-state-title">${escapeHtml(t('related.notConfigured'))}</div>
          <div class="related-state-hint">${escapeHtml(t('related.notConfiguredHint'))}</div>
          <button class="related-settings-link" type="button">${escapeHtml(t('related.openSettings'))}</button>
        </div>`;
      bindSettingsLink();
      break;
    case 'loading':
      listEl.innerHTML = `
        <div class="related-loading">
          <span class="related-spinner"></span>
          <span>${escapeHtml(t('related.loading'))}</span>
        </div>`;
      break;
    case 'error': {
      const msg = state.errorKey ? t(state.errorKey) : state.errorMessage || t('related.error');
      listEl.innerHTML = `
        <div class="related-state related-state--error">
          <div class="related-state-title">${escapeHtml(t('related.error'))}</div>
          <div class="related-state-hint">${escapeHtml(msg)}</div>
          <button class="related-retry-btn" type="button">${escapeHtml(t('related.retry'))}</button>
        </div>`;
      bindRetry();
      break;
    }
    default:
      break;
  }
  // All non-results states are auto-collapsed to keep the panel unobtrusive
  // when there's nothing to read. See applyAutoCollapse().
  applyAutoCollapse();
}

function stateMessageHTML(title: string, hint: string): string {
  return `<div class="related-state"><div class="related-state-title">${escapeHtml(title)}</div>${hint ? `<div class="related-state-hint">${escapeHtml(hint)}</div>` : ''}</div>`;
}

function bindSettingsLink(): void {
  const btn = listEl?.querySelector('.related-settings-link');
  if (btn) {
    btn.addEventListener('click', () => {
      void openOptionsPage();
    });
  }
}

function bindRetry(): void {
  const btn = listEl?.querySelector('.related-retry-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      if (lastRenderedUrl) void renderRelatedPagesByNormalized(lastRenderedUrl);
    });
  }
}

// --- Collapse control ------------------------------------------------------

/**
 * Collapsed-state setter. Centralizes the DOM updates (list class, toggle
 * button glyph, aria-label) so callers don't drift.
 *
 * Auto-collapse policy: the panel collapses whenever there is nothing useful
 * to show (loading / empty / error / disabled / not-configured) and expands
 * only when results are available. The user can still toggle manually — but
 * the next renderRelatedPages() will reapply the policy based on the new
 * status, which matches the "show me content, hide the chrome" intent.
 */
function setCollapsed(collapsed: boolean): void {
  if (!panelEl) return;
  const listContainer = panelEl.querySelector('.related-list') as HTMLElement | null;
  const toggleBtn = panelEl.querySelector('.related-toggle') as HTMLButtonElement | null;
  if (!listContainer || !toggleBtn) return;
  if (collapsed) {
    listContainer.classList.add('collapsed');
    toggleBtn.textContent = '▼';
    toggleBtn.setAttribute('aria-label', t('related.toggleExpanded'));
  } else {
    listContainer.classList.remove('collapsed');
    toggleBtn.textContent = '▲';
    toggleBtn.setAttribute('aria-label', t('related.toggleCollapsed'));
  }
}

/** Apply the auto-collapse policy based on the current status. */
function applyAutoCollapse(): void {
  setCollapsed(state.status !== 'results');
}

/**
 * Public render entry — takes a raw URL (typically `tabs[0].url`) and
 * normalizes it internally. Emits loading → results/empty/error/not-configured.
 */
export async function renderRelatedPages(currentUrl: string): Promise<void> {
  await renderRelatedPagesByNormalized(normalizeUrl(currentUrl));
}

async function renderRelatedPagesByNormalized(normalizedUrl: string): Promise<void> {
  if (!listEl) return;
  lastRenderedUrl = normalizedUrl;

  const cfg = await loadEmbeddingConfig();

  if (!cfg.enabled) {
    setState({ status: 'disabled' });
    state.hasNewRelations = false;
    updateBadge();
    return;
  }

  if (!cfg.apiKey || !cfg.apiBase || !cfg.model) {
    setState({ status: 'not-configured' });
    state.hasNewRelations = false;
    updateBadge();
    return;
  }

  // Clear any previous error message before re-entering loading.
  state.errorKey = undefined;
  state.errorMessage = undefined;
  state.status = 'loading';
  renderState(); // also auto-collapses

  try {
    const relations = await findRelatedPages(normalizedUrl);
    state.hasNewRelations = false;
    updateBadge();

    if (relations.length === 0) {
      state.status = 'empty';
      listEl.innerHTML = `<div class="related-empty">${escapeHtml(t('related.empty'))}</div>`;
      applyAutoCollapse(); // empty → collapse
      return;
    }

    state.status = 'results';
    listEl.innerHTML = relations
      .map(
        (r) => `
    <div class="related-item" data-url="${escapeHtml(r.record.url)}">
      <div class="related-item-title">${escapeHtml(r.record.title || r.record.url)}</div>
      <div class="related-item-meta">
        <span class="related-similarity">${escapeHtml(t('related.similarity'))} ${Math.round(r.similarity * 100)}%</span>
        <span class="related-time">· ${escapeHtml(formatTimeAgo(r.record.timestamp))}</span>
      </div>
      <div class="related-item-excerpt">${escapeHtml(r.record.excerpt.slice(0, 100))}</div>
    </div>`
      )
      .join('');

    listEl.querySelectorAll('.related-item').forEach((item) => {
      item.addEventListener('click', () => {
        const url = (item as HTMLElement).dataset.url;
        if (url) chrome.tabs.create({ url });
      });
    });
    applyAutoCollapse(); // results → expand
  } catch (e) {
    state.status = 'error';
    state.errorMessage = (e as Error).message;
    renderState(); // also auto-collapses
  }
}

// --- Clear All (delegates to shared/page-records-db) -----------------------

export async function clearAllPageRecords(): Promise<void> {
  await clearPageRecords();
  state.hasNewRelations = false;
  updateBadge();
  if (listEl) listEl.innerHTML = `<div class="related-empty">${escapeHtml(t('related.empty'))}</div>`;
}

// --- Initialization --------------------------------------------------------

export interface RelatedPagesDeps {
  chatArea: HTMLElement;
}

export function initRelatedPages(deps: RelatedPagesDeps): void {
  panelEl = document.createElement('div');
  panelEl.id = 'relatedPagesPanel';
  panelEl.className = 'related-panel';
  panelEl.innerHTML = `
    <div class="related-header">
      <span class="related-header-title">
        <span class="related-badge hidden"></span>
        ${t('related.title')}
      </span>
      <button class="related-toggle" type="button" aria-label="${escapeHtml(t('related.toggleCollapsed'))}" title="${escapeHtml(t('related.title'))}">▲</button>
    </div>
    <div class="related-list" id="relatedList">
      <div class="related-empty">${escapeHtml(t('related.empty'))}</div>
    </div>
  `;

  deps.chatArea.insertAdjacentElement('afterend', panelEl);

  listEl = panelEl.querySelector('#relatedList');
  badgeEl = panelEl.querySelector('.related-badge');

  // Initial state is empty (no records yet) — start collapsed so the panel
  // doesn't claim side-panel space until there's something to show.
  setCollapsed(true);

  // Capture panel locally so the click handler doesn't read the module-level
  // `panelEl` (which TS narrowing can't carry into the closure).
  const panel = panelEl;
  const toggleBtn = panel.querySelector('.related-toggle') as HTMLButtonElement;
  toggleBtn.addEventListener('click', () => {
    const listContainer = panel.querySelector('.related-list') as HTMLElement;
    setCollapsed(!listContainer.classList.contains('collapsed'));
  });

  // Legacy chrome.storage.local records are migrated to IndexedDB by the
  // service worker (sw-related-pages.ts) before any store/find is served.

  // Subscribe to PAGE_EXTRACTED instead of being imported upward by the
  // page-extractor service. This keeps the dependency direction
  // (feature → listens to event) instead of (service → feature).
  on(EVENTS.PAGE_EXTRACTED, ({ excerpt, url, title }) => {
    void requestEmbedding(excerpt, url, title);
  });
}

// --- Test hooks ------------------------------------------------------------
// Exported for unit tests; not part of the public surface used by main.ts.
export const __internals = {
  get panelEl() { return panelEl; },
  get listEl() { return listEl; },
  get badgeEl() { return badgeEl; },
  getState: () => state,
};
