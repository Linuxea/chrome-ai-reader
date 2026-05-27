import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../../src/shared/json-repair.js', () => ({
  stripMarkdownFence: vi.fn((t) => t),
  extractJsonObject: vi.fn(),
}));

vi.mock('../../../src/side_panel/state.js', () => ({
  getActiveTabId: vi.fn(() => 123),
}));

import {
  chartDataToCSV,
  chartDataToJSON,
} from '../../../src/side_panel/services/chart-extract.js';

// ---------------------------------------------------------------------------
// chartDataToCSV
// ---------------------------------------------------------------------------

describe('chartDataToCSV', () => {
  it('creates Label/Value CSV from dataPoints', () => {
    const data = {
      dataPoints: [
        { label: 'A', value: 10 },
        { label: 'B', value: 20 },
      ],
    };
    const csv = chartDataToCSV(data);
    // Strip BOM for assertions
    const body = csv.replace(/^\uFEFF/, '');
    expect(body).toContain('"Label","Value"');
    expect(body).toContain('"A",10');
    expect(body).toContain('"B",20');
  });

  it('prefixes output with BOM character', () => {
    const data = {
      dataPoints: [{ label: 'X', value: 1 }],
    };
    expect(chartDataToCSV(data).charCodeAt(0)).toBe(0xfeff);
  });

  it('creates multi-column CSV from series with xAxis values', () => {
    const data = {
      xAxis: { values: ['Jan', 'Feb', 'Mar'] },
      series: [
        { name: 'Revenue', data: [100, 200, 300] },
        { name: 'Cost', data: [50, 60, 70] },
      ],
    };
    const csv = chartDataToCSV(data);
    const body = csv.replace(/^\uFEFF/, '');
    expect(body).toContain('"Label","Revenue","Cost"');
    expect(body).toContain('"Jan",100,50');
    expect(body).toContain('"Feb",200,60');
    expect(body).toContain('"Mar",300,70');
  });

  it('auto-numbers labels when series present but no xAxis', () => {
    const data = {
      series: [{ name: 'Series A', data: [5, 10] }],
    };
    const csv = chartDataToCSV(data);
    const body = csv.replace(/^\uFEFF/, '');
    expect(body).toContain('"Label","Series A"');
    expect(body).toContain('"1",5');
    expect(body).toContain('"2",10');
  });

  it('escapes double quotes inside labels', () => {
    const data = {
      dataPoints: [{ label: 'He said "hello"', value: 42 }],
    };
    const csv = chartDataToCSV(data);
    const body = csv.replace(/^\uFEFF/, '');
    expect(body).toContain('"He said ""hello""",42');
  });

  it('escapes double quotes inside series names', () => {
    const data = {
      series: [{ name: 'Team "A"', data: [1] }],
    };
    const csv = chartDataToCSV(data);
    const body = csv.replace(/^\uFEFF/, '');
    expect(body).toContain('"Team ""A"""');
  });

  it('handles null/undefined values gracefully', () => {
    const data = {
      dataPoints: [
        { label: 'Missing', value: null },
        { label: 'Gone' },
      ],
    };
    const csv = chartDataToCSV(data);
    const body = csv.replace(/^\uFEFF/, '');
    // null -> empty, undefined -> empty
    expect(body).toContain('"Missing",');
    expect(body).toContain('"Gone",');
  });

  it('falls through to series branch when dataPoints is empty array', () => {
    const data = {
      dataPoints: [],
      series: [{ name: 'S', data: [1] }],
    };
    const csv = chartDataToCSV(data);
    const body = csv.replace(/^\uFEFF/, '');
    expect(body).toContain('"Label","S"');
  });

  it('returns only BOM when no dataPoints or series', () => {
    const csv = chartDataToCSV({});
    expect(csv).toBe('\uFEFF');
  });
});

// ---------------------------------------------------------------------------
// chartDataToJSON
// ---------------------------------------------------------------------------

describe('chartDataToJSON', () => {
  it('stringifies a basic object', () => {
    const data = { title: 'Chart', value: 42 };
    const json = chartDataToJSON(data);
    expect(json).toBe(JSON.stringify(data, null, 2));
  });

  it('preserves nested structure', () => {
    const data = {
      series: [{ name: 'A', data: [1, 2, 3] }],
      xAxis: { label: 'X', values: ['a', 'b', 'c'] },
    };
    const json = chartDataToJSON(data);
    const parsed = JSON.parse(json);
    expect(parsed.series[0].data).toEqual([1, 2, 3]);
    expect(parsed.xAxis.values).toEqual(['a', 'b', 'c']);
  });

  it('handles arrays correctly', () => {
    const data = [1, 2, 3];
    const json = chartDataToJSON(data);
    expect(JSON.parse(json)).toEqual([1, 2, 3]);
  });
});
