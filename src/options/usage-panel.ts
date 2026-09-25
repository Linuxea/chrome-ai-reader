/**
 * F9 — token usage on the options page: per-model totals for today, the
 * last 7 days and the last 30 days, from the worker's usage accounting.
 * Clearing resets the statistics (not any conversation).
 */

import { t } from '../shared/i18n.js';
import { USAGE_KEY, summarizeUsage, type UsageStats } from '../shared/usage-stats';

const fmt = (n: number): string => n.toLocaleString();

export async function renderUsage(container: HTMLElement, rangeDays: number): Promise<void> {
  const data = await chrome.storage.local.get(USAGE_KEY);
  const rows = summarizeUsage((data[USAGE_KEY] as UsageStats | undefined) ?? {}, rangeDays);
  container.textContent = '';
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('settings.usage.empty');
    container.appendChild(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'usage-table';
  const head = table.createTHead().insertRow();
  for (const key of ['settings.usage.model', 'settings.usage.requests', 'settings.usage.input', 'settings.usage.output']) {
    const th = document.createElement('th');
    th.textContent = t(key);
    head.appendChild(th);
  }
  const body = table.createTBody();
  const total = { requests: 0, inputTokens: 0, outputTokens: 0 };
  for (const r of rows) {
    const tr = body.insertRow();
    for (const v of [r.model, fmt(r.requests), fmt(r.inputTokens), fmt(r.outputTokens)]) tr.insertCell().textContent = v;
    total.requests += r.requests; total.inputTokens += r.inputTokens; total.outputTokens += r.outputTokens;
  }
  if (rows.length > 1) {
    const tr = body.insertRow();
    tr.className = 'usage-total';
    for (const v of [t('settings.usage.total'), fmt(total.requests), fmt(total.inputTokens), fmt(total.outputTokens)]) tr.insertCell().textContent = v;
  }
  container.appendChild(table);
}

export function initUsagePanel(): void {
  const container = document.getElementById('usageTable');
  const range = document.getElementById('usageRange') as HTMLSelectElement | null;
  const clear = document.getElementById('usageClearBtn');
  if (!container || !range) return;
  const refresh = () => { void renderUsage(container, Number(range.value) || 7); };
  range.addEventListener('change', refresh);
  clear?.addEventListener('click', async () => {
    if (!confirm(t('settings.usage.clearConfirm'))) return;
    await chrome.storage.local.remove(USAGE_KEY);
    refresh();
  });
  refresh();
}
