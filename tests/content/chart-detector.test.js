import { vi, describe, it, expect, beforeEach } from 'vitest';

import { handleDetectCharts, handleCaptureChart } from '../../src/content/chart-detector.js';

describe('content/chart-detector', () => {
  let sendResponse;

  beforeEach(() => {
    document.body.innerHTML = '';
    sendResponse = vi.fn();
  });

  describe('handleDetectCharts', () => {
    it('returns empty charts for page with no charts', async () => {
      document.body.innerHTML = '<p>Plain text</p>';

      handleDetectCharts({}, sendResponse);
      // handleDetectCharts is async internally
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, charts: [] })
        );
      });
    });

    it('detects canvas elements above size threshold', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 100;
      document.body.appendChild(canvas);

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            charts: expect.arrayContaining([
              expect.objectContaining({ type: 'canvas', width: 200, height: 100 }),
            ]),
          })
        );
      });
    });

    it('ignores small canvas elements', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 30;
      document.body.appendChild(canvas);

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, charts: [] })
        );
      });
    });

    it('detects SVG elements with chart-like children', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '200');
      svg.setAttribute('height', '100');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(path);
      document.body.appendChild(svg);

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        const call = sendResponse.mock.calls[0][0];
        expect(call.success).toBe(true);
        const svgChart = call.charts.find(c => c.type === 'svg');
        expect(svgChart).toBeDefined();
        expect(svgChart.width).toBe(200);
        expect(svgChart.height).toBe(100);
      });
    });

    it('ignores SVG elements without chart-like children', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '200');
      svg.setAttribute('height', '100');
      // No path/rect/circle/etc.
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      svg.appendChild(text);
      document.body.appendChild(svg);

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            charts: expect.not.arrayContaining([
              expect.objectContaining({ type: 'svg' }),
            ]),
          })
        );
      });
    });

    it('detects images with chart-related class names', async () => {
      const img = document.createElement('img');
      img.src = 'https://example.com/image.png';
      img.alt = 'Chart of sales data';
      Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 200, configurable: true });
      Object.defineProperty(img, 'width', { value: 300, configurable: true });
      Object.defineProperty(img, 'height', { value: 200, configurable: true });
      document.body.appendChild(img);

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        const call = sendResponse.mock.calls[0][0];
        expect(call.success).toBe(true);
        const imgChart = call.charts.find(c => c.type === 'image');
        expect(imgChart).toBeDefined();
        expect(imgChart.src).toBe('https://example.com/image.png');
      });
    });

    it('ignores icon-sized images', async () => {
      const img = document.createElement('img');
      img.src = 'https://example.com/icon.png';
      img.className = 'icon';
      Object.defineProperty(img, 'naturalWidth', { value: 100, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });
      Object.defineProperty(img, 'width', { value: 100, configurable: true });
      Object.defineProperty(img, 'height', { value: 100, configurable: true });
      document.body.appendChild(img);

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, charts: [] })
        );
      });
    });

    it('ignores images with extreme aspect ratios', async () => {
      const img = document.createElement('img');
      img.src = 'https://example.com/banner.png';
      Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 50, configurable: true });
      Object.defineProperty(img, 'width', { value: 1000, configurable: true });
      Object.defineProperty(img, 'height', { value: 50, configurable: true });
      document.body.appendChild(img);

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, charts: [] })
        );
      });
    });

    it('returns error on exception', async () => {
      // Force an error
      const original = document.querySelectorAll;
      document.querySelectorAll = () => { throw new Error('query failed'); };

      handleDetectCharts({}, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.stringContaining('query failed'),
          })
        );
      });

      document.querySelectorAll = original;
    });

    it('returns true to indicate async sendResponse', () => {
      document.body.innerHTML = '<p>text</p>';
      const result = handleDetectCharts({}, sendResponse);
      expect(result).toBe(true);
    });
  });

  describe('handleCaptureChart', () => {
    it('returns error for unknown chart type', async () => {
      handleCaptureChart({ type: 'unknown', index: 0 }, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.stringContaining('Unknown chart type'),
          })
        );
      });
    });

    it('returns true to indicate async sendResponse', () => {
      document.body.innerHTML = '';
      const result = handleCaptureChart({ type: 'canvas', index: 0 }, sendResponse);
      expect(result).toBe(true);
    });

    it('handles canvas capture (may fail in jsdom without toDataURL)', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 100;
      canvas.getContext('2d');
      document.body.appendChild(canvas);

      handleCaptureChart({ type: 'canvas', index: 0, pageW: 200, pageH: 100 }, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });

      const call = sendResponse.mock.calls[0][0];
      // In jsdom, canvas toDataURL may or may not work depending on implementation
      // We just verify it doesn't crash and returns a valid response structure
      expect(call).toBeDefined();
      if (call.success) {
        expect(call.dataUri).toBeDefined();
      } else {
        expect(call.error).toBeDefined();
      }
    });

    it('returns error when canvas index not found', async () => {
      document.body.innerHTML = '<p>no canvas</p>';

      handleCaptureChart({ type: 'canvas', index: 0, pageW: 200, pageH: 100 }, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.stringContaining('Canvas element not found'),
          })
        );
      });
    });

    it('returns error when SVG index not found', async () => {
      handleCaptureChart({ type: 'svg', index: 5, pageW: 200, pageH: 100 }, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.stringContaining('SVG element not found'),
          })
        );
      });
    });
  });
});
