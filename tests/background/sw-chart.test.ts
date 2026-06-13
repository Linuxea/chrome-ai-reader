/**
 * Tests for background/sw-chart.ts — GLM-4V vision extraction, chart analysis,
 * and visible-tab screenshot crop.
 *
 * Three exported functions, all return `true` (async response pattern):
 * - handleChartVision: GLM-4V vision model for chart data extraction
 * - handleChartAnalysis: DeepSeek/OpenAI for chart insights
 * - handleChartScreenshot: captureVisibleTab + OffscreenCanvas crop
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mock chrome.tabs.captureVisibleTab and chrome.runtime.lastError ---
let _lastError: chrome.runtime.LastError | undefined;
let _captureResult: string | undefined;

vi.stubGlobal('chrome', {
  runtime: {
    get lastError() { return _lastError; },
  },
  tabs: {
    captureVisibleTab: vi.fn((_tabId: unknown, _opts: unknown, cb: (dataUrl?: string) => void) => {
      cb(_captureResult);
    }),
  },
});

import {
  handleChartVision,
  handleChartAnalysis,
  handleChartScreenshot,
} from '../../src/background/sw-chart.js';

describe('background/sw-chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _lastError = undefined;
    _captureResult = 'data:image/png;base64,abc';
  });

  // ==========================================================================
  // handleChartVision
  // ==========================================================================
  describe('handleChartVision', () => {
    it('sends error when no API key', () => {
      const sendResponse = vi.fn();
      const result = handleChartVision({ apiKey: undefined, messages: [] }, sendResponse);
      expect(result).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No API Key',
      });
    });

    it('fetches from GLM-4V endpoint and returns content on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'chart data JSON' } }],
          }),
      } as Response);

      const sendResponse = vi.fn();
      const messages = [{ role: 'user', content: 'extract chart' }];
      handleChartVision({ apiKey: 'glm-key', messages }, sendResponse);

      // Flush async fetch chain
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

      expect(fetch).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer glm-key',
          }),
        }),
      );
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        content: 'chart data JSON',
      });
    });

    it('returns empty content when response has no message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [{}] }),
      } as Response);

      const sendResponse = vi.fn();
      handleChartVision({ apiKey: 'glm-key', messages: [] }, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        content: '',
      });
    });

    it('handles non-OK HTTP with API error message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: { message: 'Invalid API key' },
          }),
      } as Response);

      const sendResponse = vi.fn();
      handleChartVision({ apiKey: 'bad-key', messages: [] }, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid API key',
      });
    });

    it('handles fetch rejection', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const sendResponse = vi.fn();
      handleChartVision({ apiKey: 'glm-key', messages: [] }, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Network error',
      });
    });
  });

  // ==========================================================================
  // handleChartAnalysis
  // ==========================================================================
  describe('handleChartAnalysis', () => {
    it('sends error when no API key', () => {
      const sendResponse = vi.fn();
      const result = handleChartAnalysis(
        { apiKey: undefined, messages: [] },
        sendResponse,
      );
      expect(result).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No API Key',
      });
    });

    it('uses custom apiBase and modelName', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: '{"summary":"ok"}' } }],
          }),
      } as Response);

      const sendResponse = vi.fn();
      handleChartAnalysis(
        {
          apiKey: 'ds-key',
          apiBase: 'https://custom.api.com',
          modelName: 'custom-model',
          messages: [],
        },
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

      expect(fetch).toHaveBeenCalledWith(
        'https://custom.api.com/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      const body = JSON.parse(fetchCall.body as string);
      expect(body.model).toBe('custom-model');
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('defaults to DeepSeek API base and model', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: '{}' } }],
          }),
      } as Response);

      const sendResponse = vi.fn();
      handleChartAnalysis({ apiKey: 'ds-key', messages: [] }, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      const body = JSON.parse(fetchCall.body as string);
      expect(body.model).toBe('deepseek-chat');
    });

    it('handles API error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        json: () =>
          Promise.resolve({
            error: { message: 'Rate limited' },
          }),
      } as Response);

      const sendResponse = vi.fn();
      handleChartAnalysis({ apiKey: 'ds-key', messages: [] }, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Rate limited',
      });
    });
  });

  // ==========================================================================
  // handleChartScreenshot
  // ==========================================================================
  describe('handleChartScreenshot', () => {
    /**
     * Mock createImageBitmap + OffscreenCanvas + fetch(dataUrl).blob() for the crop logic.
     * jsdom doesn't implement these APIs, and the code fetches the captured data URL
     * to get a Blob, then createImageBitmap to get dimensions.
     */
    function setupScreenshotMocks(
      bmpWidth: number,
      bmpHeight: number,
    ) {
      const mockCtx = {
        drawImage: vi.fn(),
      };
      const mockBlob = {
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      };
      const mockCanvas = {
        getContext: vi.fn(() => mockCtx),
        convertToBlob: vi.fn(() => Promise.resolve(mockBlob)),
      };
      // Mock fetch for the internal `fetch(dataUrl)` → `.blob()` call
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob()),
      } as Response);
      // Must use regular function (not arrow) since code calls `new OffscreenCanvas(...)`
      vi.stubGlobal('OffscreenCanvas', vi.fn(function () { return mockCanvas; }));
      vi.stubGlobal('createImageBitmap', vi.fn(() =>
        Promise.resolve({ width: bmpWidth, height: bmpHeight }),
      ));
      return { mockCtx, mockBlob, mockCanvas };
    }

    it('sends error when capture fails (lastError set)', async () => {
      _lastError = { message: 'capture denied' };
      _captureResult = undefined;

      const sendResponse = vi.fn();
      handleChartScreenshot(
        { scrollX: 0, scrollY: 0, pageX: 0, pageY: 0, pageW: 100, pageH: 100 },
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'capture denied',
      });
    });

    it('sends error when capture returns no data', async () => {
      _captureResult = undefined;

      const sendResponse = vi.fn();
      handleChartScreenshot(
        { scrollX: 0, scrollY: 0, pageX: 0, pageY: 0, pageW: 100, pageH: 100 },
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        }),
      );
    });

    it('crops and returns base64 dataUri on success', async () => {
      setupScreenshotMocks(800, 600); // bitmap larger than crop area

      const sendResponse = vi.fn();
      handleChartScreenshot(
        {
          scrollX: 0,
          scrollY: 0,
          pageX: 10,
          pageY: 20,
          pageW: 200,
          pageH: 150,
          devicePixelRatio: 2,
        },
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          dataUri: expect.stringContaining('data:image/png;base64,'),
        }),
      );
    });

    it('returns error when crop area is entirely outside screenshot', async () => {
      // pageX/pageY so large that after subtracting scroll, the crop origin
      // exceeds bitmap dimensions → sw=0 or sh=0 → "Crop area is outside"
      setupScreenshotMocks(100, 100);

      const sendResponse = vi.fn();
      handleChartScreenshot(
        {
          scrollX: 0,
          scrollY: 0,
          pageX: 500,
          pageY: 500,
          pageW: 200,
          pageH: 200,
          devicePixelRatio: 1,
        },
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('outside'),
        }),
      );
    });
  });
});
