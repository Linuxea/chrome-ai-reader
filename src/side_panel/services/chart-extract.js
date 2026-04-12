import { t } from '../../shared/i18n.js';
import * as state from '../state.js';

const CHART_EXTRACT_PROMPT = `你是一个专业的数据分析师。请分析这张图表截图。

请提取以下信息，直接输出纯 JSON（不要用 markdown 代码块包裹）：
{
  "title": "图表标题",
  "chartType": "图表类型（line/bar/pie/scatter/area/table/other）",
  "xAxis": { "label": "X轴标签", "values": ["值1", "值2", ...] },
  "yAxis": { "label": "Y轴标签", "values": [数值1, 数值2, ...] },
  "series": [
    { "name": "系列名称", "data": [数值1, 数值2, ...] }
  ],
  "dataPoints": [
    { "label": "标签", "value": 数值 }
  ],
  "legend": ["系列1", "系列2"]
}

注意事项：
1. 尽可能精确地读取所有可见的数据值
2. 如果无法确定精确值，给出合理的估算值
3. series 和 dataPoints 至少提供一个
4. 所有数值必须是数字类型，不能是字符串
5. 只输出 JSON，不要输出其他内容`;

const CHART_INSIGHT_PROMPT = `你是一个专业的数据分析师。以下是提取自图表的结构化数据：

{data}

请分析并提供以下内容，直接输出纯 JSON（不要用 markdown 代码块包裹）：
{
  "summary": "一句话概括图表内容",
  "trends": ["趋势1", "趋势2", "趋势3"],
  "anomalies": ["异常点或值得注意的数据（如有）"],
  "statistics": {
    "mean": "平均值（如适用）",
    "max": "最大值",
    "min": "最小值",
    "growth": "增长率或变化幅度（如适用）"
  },
  "insights": ["洞察1", "洞察2", "洞察3"]
}

用中文回答，保持专业但易懂。只输出 JSON，不要输出其他内容。`;

export async function detectCharts() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error(t('error.noTab'));
  state.setActiveTabId(tab.id);

  const response = await chrome.tabs.sendMessage(tab.id, { action: 'detectCharts' });
  if (!response?.success) {
    throw new Error(response?.error || t('chart.extractFailed'));
  }
  return response.charts || [];
}

export async function captureChart(chartInfo) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error(t('error.noTab'));

  const response = await chrome.tabs.sendMessage(tab.id, {
    action: 'captureChart',
    type: chartInfo.type,
    index: chartInfo.index,
    pageX: chartInfo.pageX,
    pageY: chartInfo.pageY,
    pageW: chartInfo.pageW,
    pageH: chartInfo.pageH
  });
  if (!response?.success) {
    throw new Error(response?.error || t('chart.extractFailed'));
  }
  return response.dataUri;
}

export async function extractChartData(dataUri) {
  const { ocrApiKey } = await chrome.storage.sync.get(['ocrApiKey']);
  if (!ocrApiKey) throw new Error(t('chart.noOcrApiKey'));

  const response = await chrome.runtime.sendMessage({
    action: 'analyzeChartVision',
    apiKey: ocrApiKey,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: CHART_EXTRACT_PROMPT },
          { type: 'image_url', image_url: { url: dataUri } }
        ]
      }
    ]
  });

  if (!response?.success) {
    throw new Error(response?.error || t('chart.extractFailed'));
  }

  const content = response.content || '{}';
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(t('chart.noData'));

  return JSON.parse(jsonMatch[0]);
}

export async function generateInsights(chartData) {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);
  if (!apiKey) throw new Error(t('chart.noApiKey'));

  const dataStr = JSON.stringify(chartData, null, 2);
  const promptText = CHART_INSIGHT_PROMPT.replace('{data}', dataStr);

  const messages = [
    { role: 'system', content: '你是一个专业的数据分析师，擅长从数据中发现趋势和洞察。请用中文回答。' },
    { role: 'user', content: promptText }
  ];

  const response = await chrome.runtime.sendMessage({
    action: 'analyzeChart',
    apiKey,
    apiBase,
    modelName,
    messages
  });

  if (!response?.success) {
    throw new Error(response?.error || t('chart.analyzeFailed'));
  }

  const content = response.content || '{}';
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(t('chart.analyzeFailed'));

  return JSON.parse(jsonMatch[0]);
}

export function chartDataToCSV(chartData) {
  const rows = [];
  if (chartData.dataPoints && chartData.dataPoints.length > 0) {
    rows.push('Label,Value');
    chartData.dataPoints.forEach(dp => {
      rows.push(`"${dp.label || ''}",${dp.value != null ? dp.value : ''}`);
    });
  } else if (chartData.series && chartData.series.length > 0) {
    const labels = chartData.xAxis?.values || chartData.series[0]?.data?.map((_, i) => i + 1) || [];
    const header = ['Label', ...chartData.series.map(s => s.name || 'Series')];
    rows.push(header.join(','));
    labels.forEach((label, i) => {
      const row = [`"${label}"`];
      chartData.series.forEach(s => {
        row.push(s.data?.[i] != null ? s.data[i] : '');
      });
      rows.push(row.join(','));
    });
  }
  return rows.join('\n');
}

export function chartDataToJSON(chartData) {
  return JSON.stringify(chartData, null, 2);
}
