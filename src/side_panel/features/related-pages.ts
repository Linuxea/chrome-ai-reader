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
const THRESHOLD_DEFAULT = 0.7;
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

  return new Promise<void>((resolve) => {
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
    await chrome.storage.local.set({ [PAUSE_KEY]: Date.now() + PAUSE_DURATION_MS });
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

  // Update existing record for same URL rather than creating a duplicate
  const existingIdx = records.findIndex((r) => r.url === record.url);
  if (existingIdx >= 0) {
    records[existingIdx] = { ...records[existingIdx], ...record, timestamp: Date.now() };
  } else {
    records.push({ ...record, id: crypto.randomUUID(), timestamp: Date.now() });
  }

  // FIFO cleanup — oldest records evicted when exceeding max
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
  const currentRecord = records.find((r) => r.url === currentUrl);
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

  listEl.innerHTML = relations
    .map(
      (r) => `
    <div class="related-item" data-url="${escapeHtml(r.record.url)}">
      <div class="related-item-title">${escapeHtml(r.record.title || r.record.url)}</div>
      <div class="related-item-meta">
        <span class="related-similarity">${t('related.similarity')} ${Math.round(r.similarity * 100)}%</span>
        <span class="related-time">· ${formatTimeAgo(r.record.timestamp)}</span>
      </div>
      <div class="related-item-excerpt">${escapeHtml(r.record.excerpt.slice(0, 100))}</div>
    </div>`
    )
    .join('');

  // Click handlers — open related page in a new tab
  listEl.querySelectorAll('.related-item').forEach((item) => {
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
  // Create panel DOM — inserted after the chat area
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

  // Toggle collapse/expand
  const toggleBtn = panelEl.querySelector('.related-toggle') as HTMLButtonElement;
  const listContainer = panelEl.querySelector('.related-list') as HTMLElement;
  toggleBtn.addEventListener('click', () => {
    const collapsed = listContainer.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '▼' : '▲';
  });
}
