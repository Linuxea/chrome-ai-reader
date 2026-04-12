// features/chart-analyzer.js — Chart analysis UI in the chat area

import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/constants.js';
import * as state from '../state.js';
import { appendMessage, scrollToBottom } from '../ui/dom-helpers.js';
import {
  detectCharts,
  captureChart,
  extractChartData,
  generateInsights,
  chartDataToCSV,
  chartDataToJSON
} from '../services/chart-extract.js';

const TYPE_ICONS = { canvas: '\u{1F5A5}\uFE0F', svg: '\u{1F4D0}', image: '\u{1F4CA}' };

let _chatArea;
let _chartBtn;
let _currentCard = null;

export function initChartAnalyzer({ chatArea }) {
  _chatArea = chatArea;
  _chartBtn = document.querySelector('[data-action="chart"]');
  state.subscribe('isGenerating', (v) => {
    if (_chartBtn && !state.getIsChartGenerating()) {
      _chartBtn.disabled = v;
    }
  });
}

export async function handleChartClick() {
  if (state.getIsGenerating() || state.getIsChartGenerating()) return;

  const existing = _chatArea.querySelector('.chart-card');
  if (existing) existing.remove();

  const welcome = _chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const card = createChartCard();
  _currentCard = card;
  updateStatus(card, t('chart.detecting'));

  try {
    const charts = await detectCharts();
    state.setDetectedCharts(charts);

    if (!charts || charts.length === 0) {
      updateStatus(card, t('chart.noCharts'));
      resetState();
      return;
    }

    hideStatus(card);
    renderChartList(card, charts);
  } catch (e) {
    updateStatus(card, e.message || t('chart.extractFailed'));
    resetState();
  }

  scrollToBottom();
}

function createChartCard() {
  const card = document.createElement('div');
  card.className = 'chart-card';

  card.innerHTML = `
    <div class="chart-card-header">
      <span class="chart-card-title">\u{1F4CA} ${t('chart.cardTitle')}</span>
      <button class="chart-card-close" title="${t('chart.close')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="chart-status">
      <div class="chart-status-spinner"></div>
      <span></span>
    </div>
    <div class="chart-chart-list"></div>
    <div class="chart-results"></div>
  `;

  card.querySelector('.chart-card-close').addEventListener('click', () => {
    card.remove();
    _currentCard = null;
    resetState();
    restoreWelcomeIfNeeded();
  });

  _chatArea.appendChild(card);
  scrollToBottom();

  return card;
}

function updateStatus(card, text) {
  const statusEl = card.querySelector('.chart-status');
  statusEl.style.display = '';
  statusEl.innerHTML = `<div class="chart-status-spinner"></div><span>${escapeHtml(text)}</span>`;
}

function hideStatus(card) {
  const statusEl = card.querySelector('.chart-status');
  statusEl.style.display = 'none';
}

function showError(card, text) {
  const statusEl = card.querySelector('.chart-status');
  statusEl.style.display = '';
  statusEl.innerHTML = `<span>${escapeHtml(text)}</span>`;
}

function renderChartList(card, charts) {
  const listEl = card.querySelector('.chart-chart-list');
  listEl.innerHTML = `<p class="chart-select-hint">${escapeHtml(t('chart.selectChart'))}</p>`;

  let selectedIndex = -1;

  charts.forEach((chart, i) => {
    const item = document.createElement('div');
    item.className = 'chart-chart-item';

    const typeIcon = TYPE_ICONS[chart.type] || TYPE_ICONS.image;
    const typeLabel =
      chart.type === 'canvas' ? t('chart.typeCanvas') :
      chart.type === 'svg' ? t('chart.typeSVG') :
      t('chart.typeImage');

    const sizeText = chart.width && chart.height ? `${chart.width}×${chart.height}` : '';

    const thumbHtml = chart.thumbnail
      ? `<img class="chart-chart-thumb" src="${escapeHtml(chart.thumbnail)}" alt="${escapeHtml(typeLabel)}" loading="lazy">`
      : `<span class="chart-chart-type">${typeIcon}</span>`;

    item.innerHTML = `
      ${thumbHtml}
      <div class="chart-chart-info">
        <span class="chart-chart-label">${escapeHtml(typeLabel)}</span>
        ${sizeText ? `<span class="chart-chart-size">${sizeText}</span>` : ''}
      </div>
    `;

    item.addEventListener('click', () => {
      listEl.querySelectorAll('.chart-chart-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      selectedIndex = i;
      analyzeBtn.disabled = false;
    });

    listEl.appendChild(item);
  });

  const analyzeBtn = document.createElement('button');
  analyzeBtn.className = 'chart-analyze-btn';
  analyzeBtn.textContent = t('chart.analyze');
  analyzeBtn.disabled = true;

  analyzeBtn.addEventListener('click', () => {
    if (selectedIndex < 0 || selectedIndex >= charts.length) return;
    const chartInfo = charts[selectedIndex];
    listEl.style.display = 'none';
    startAnalysis(card, chartInfo);
  });

  listEl.appendChild(analyzeBtn);
}

async function startAnalysis(card, chartInfo) {
  state.setIsChartGenerating(true);
  if (_chartBtn) _chartBtn.disabled = true;

  try {
    updateStatus(card, t('chart.extracting'));
    scrollToBottom();

    const dataUri = await captureChart(chartInfo);
    const chartData = await extractChartData(dataUri);

    if (!chartData || ((!chartData.dataPoints || chartData.dataPoints.length === 0) && (!chartData.series || chartData.series.length === 0))) {
      showError(card, t('chart.noData'));
      resetState();
      return;
    }

    updateStatus(card, t('chart.analyzing'));
    scrollToBottom();

    const insights = await generateInsights(chartData);

    hideStatus(card);
    renderResults(card, chartData, insights);
    scrollToBottom();
  } catch (e) {
    showError(card, e.message || t('chart.analyzeFailed'));
  } finally {
    resetState();
  }
}

function renderResults(card, chartData, insights) {
  const resultsEl = card.querySelector('.chart-results');
  resultsEl.innerHTML = '';

  if (insights.summary) {
    const summary = document.createElement('div');
    summary.className = 'chart-summary';
    summary.textContent = insights.summary;
    resultsEl.appendChild(summary);
  }

  if (chartData) {
    const barSection = document.createElement('div');
    barSection.className = 'chart-bar-chart';
    renderBarChart(barSection, chartData);
    if (barSection.children.length > 0) resultsEl.appendChild(barSection);
  }

  if (insights.trends && insights.trends.length > 0) {
    const trendsSection = document.createElement('div');
    trendsSection.className = 'chart-trend-list';
    trendsSection.innerHTML = `<h4>${t('chart.insights')}</h4><ul>${insights.trends.map(tr => `<li>${escapeHtml(tr)}</li>`).join('')}</ul>`;
    resultsEl.appendChild(trendsSection);
  }

  if (insights.statistics) {
    const statsSection = document.createElement('div');
    statsSection.className = 'chart-stats-grid';
    statsSection.innerHTML = `<h4>${t('chart.stats')}</h4>`;

    const stats = insights.statistics;
    const statEntries = [
      { label: t('chart.statMean'), value: stats.mean },
      { label: t('chart.statMax'), value: stats.max },
      { label: t('chart.statMin'), value: stats.min },
      { label: t('chart.statGrowth'), value: stats.growth }
    ].filter(e => e.value != null && e.value !== '');

    statEntries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'chart-stat-item';
      item.innerHTML = `<span class="chart-stat-label">${escapeHtml(String(entry.label))}</span><span class="chart-stat-value">${escapeHtml(String(entry.value))}</span>`;
      statsSection.appendChild(item);
    });

    if (statEntries.length > 0) resultsEl.appendChild(statsSection);
  }

  if (insights.insights && insights.insights.length > 0) {
    const insightsSection = document.createElement('div');
    insightsSection.className = 'chart-insight-list';
    insightsSection.innerHTML = `<h4>${t('chart.insights')}</h4><ul>${insights.insights.map(ins => `<li>${escapeHtml(ins)}</li>`).join('')}</ul>`;
    resultsEl.appendChild(insightsSection);
  }

  if (chartData) {
    const tableSection = document.createElement('div');
    tableSection.className = 'chart-data-table';
    tableSection.innerHTML = `<h4>${t('chart.data')}</h4>`;
    const scroll = document.createElement('div');
    scroll.className = 'chart-data-scroll';
    renderDataTable(scroll, chartData);
    if (scroll.children.length > 0) {
      tableSection.appendChild(scroll);
      resultsEl.appendChild(tableSection);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'chart-actions';

  const csvBtn = document.createElement('button');
  csvBtn.className = 'chart-action-btn';
  csvBtn.textContent = t('chart.exportCSV');
  csvBtn.addEventListener('click', () => {
    const csv = chartDataToCSV(chartData);
    downloadFile(csv, 'chart-data.csv', 'text/csv;charset=utf-8');
  });

  const jsonBtn = document.createElement('button');
  jsonBtn.className = 'chart-action-btn';
  jsonBtn.textContent = t('chart.exportJSON');
  jsonBtn.addEventListener('click', () => {
    const json = chartDataToJSON(chartData);
    downloadFile(json, 'chart-data.json', 'application/json;charset=utf-8');
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'chart-action-btn';
  copyBtn.textContent = t('chart.copy');
  copyBtn.addEventListener('click', () => {
    const json = chartDataToJSON(chartData);
    navigator.clipboard.writeText(json).then(() => {
      copyBtn.textContent = t('chart.copied');
      setTimeout(() => { copyBtn.textContent = t('chart.copy'); }, 2000);
    });
  });

  actions.appendChild(csvBtn);
  actions.appendChild(jsonBtn);
  actions.appendChild(copyBtn);
  resultsEl.appendChild(actions);
}

function renderBarChart(container, chartData) {
  let items = [];

  if (chartData.dataPoints && chartData.dataPoints.length > 0) {
    items = chartData.dataPoints.slice(0, 15).map(dp => ({
      label: String(dp.label || ''),
      value: Number(dp.value) || 0
    }));
  } else if (chartData.series && chartData.series.length > 0) {
    const series = chartData.series[0];
    const labels = chartData.xAxis?.values || series.data?.map((_, i) => String(i + 1)) || [];
    items = series.data.slice(0, 15).map((v, i) => ({
      label: String(labels[i] || i + 1),
      value: Number(v) || 0
    }));
  }

  if (items.length === 0) return;

  const maxVal = Math.max(...items.map(it => Math.abs(it.value)), 1);

  items.forEach(item => {
    const pct = (Math.abs(item.value) / maxVal) * 100;
    const row = document.createElement('div');
    row.className = 'chart-bar-row';
    row.innerHTML = `
      <span class="chart-bar-label">${escapeHtml(item.label)}</span>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
      <span class="chart-bar-value">${item.value}</span>
    `;
    container.appendChild(row);
  });
}

function renderDataTable(container, chartData) {
  if (chartData.dataPoints && chartData.dataPoints.length > 0) {
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>${escapeHtml(t('chart.label'))}</th><th>${escapeHtml(t('chart.value'))}</th></tr></thead><tbody>${chartData.dataPoints.map(dp => `<tr><td>${escapeHtml(String(dp.label || ''))}</td><td>${dp.value != null ? dp.value : ''}</td></tr>`).join('')}</tbody>`;
    container.appendChild(table);
  } else if (chartData.series && chartData.series.length > 0) {
    const labels = chartData.xAxis?.values || chartData.series[0]?.data?.map((_, i) => String(i + 1)) || [];
    const headerCells = [t('chart.label'), ...chartData.series.map(s => escapeHtml(s.name || t('chart.series')))];
    const rows = labels.map((label, i) => {
      const cells = [`<td>${escapeHtml(String(label))}</td>`];
      chartData.series.forEach(s => {
        cells.push(`<td>${s.data?.[i] != null ? s.data[i] : ''}</td>`);
      });
      return `<tr>${cells.join('')}</tr>`;
    });
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr>${headerCells.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
    container.appendChild(table);
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetState() {
  state.setIsChartGenerating(false);
  if (_chartBtn) _chartBtn.disabled = false;
}

function restoreWelcomeIfNeeded() {
  if (_chatArea.children.length === 0) {
    const welcome = document.createElement('div');
    welcome.className = 'welcome-msg';
    welcome.innerHTML = `<p data-i18n="sidebar.welcome">${t('sidebar.welcome')}</p>`;
    _chatArea.appendChild(welcome);
  }
}
