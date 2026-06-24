import { vi, describe, it, expect, beforeEach } from 'vitest';
import { buildAnnotationMessages, parseAnnotationResponse, annotateChunk, __resetJsonModeFlag } from '../../src/background/sw-annotation.js';
import { getPrompt } from '../../src/shared/prompts';
import { safePostMessage } from '../../src/background/sw-utils.js';
import type { Annotation } from '../../src/shared/types';

// The system prompt now lives in src/shared/prompts.ts; re-derive it for the
// content-quality assertions below.
const ANNOTATION_SYSTEM_PROMPT = getPrompt('annotation.system', 'zh');

// --- Mock chrome.storage.sync (for annotateChunk config read) ---
const annotationStore: Record<string, unknown> = {
  apiKey: 'sk-test',
  apiBase: 'https://api.deepseek.com',
  modelName: 'deepseek-chat',
};
vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys: string[] | string) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((k) => {
          if (annotationStore[k] !== undefined) result[k] = annotationStore[k];
        });
        return Promise.resolve(result);
      },
    },
  },
});

// --- Mock sw-utils (vi.mock is hoisted to top of file) ---
vi.mock('../../src/background/sw-utils.js', () => ({
  safePostMessage: vi.fn(),
}));

// --- Mock global fetch ---
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockPort() {
  return {
    postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
  } as unknown as chrome.runtime.Port;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('sw-annotation prompt assembly', () => {
  describe('ANNOTATION_SYSTEM_PROMPT', () => {
    it('defines the three perspectives', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('critique');
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('counterpoint');
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('flaw');
    });

    it('demands verbatim quotes', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toMatch(/原样|verbatim|真实存在/);
    });

    it('allows returning empty when nothing is worth annotating', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('宁缺毋滥');
    });
  });

  describe('buildAnnotationMessages', () => {
    it('returns system + user messages with full article and target chunk', () => {
      const messages = buildAnnotationMessages({
        fullArticle: 'FULL ARTICLE TEXT',
        chunkIndex: 3,
        chunkText: 'TARGET CHUNK TEXT',
      });

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'system', content: ANNOTATION_SYSTEM_PROMPT });

      const user = messages[1].content as string;
      expect(user).toContain('FULL ARTICLE TEXT');
      expect(user).toContain('TARGET CHUNK TEXT');
      expect(user).toContain('<full_article>');
      expect(user).toContain('<target_chunk>');
      expect(user).toContain('第 3 段');
    });
  });

  describe('parseAnnotationResponse', () => {
    it('parses a valid response into Annotation[]', () => {
      const raw = JSON.stringify({
        annotations: [
          { perspective: 'critique', quote: '性能提升 30%', comment: '基线是什么？' },
          { perspective: 'flaw', quote: '因此 A 导致 B', comment: '推理跳步。' },
        ],
      });

      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(2);
      expect(result[0].perspective).toBe('critique');
      expect(result[0].quote).toBe('性能提升 30%');
      expect(result[0].id).toMatch(/^[\da-f-]{36}$/i); // UUID shape
    });

    it('returns empty array when model reports no worthy points', () => {
      const result = parseAnnotationResponse(JSON.stringify({ annotations: [] }));
      expect(result).toEqual([]);
    });

    it('falls back to Math.random-based id when crypto.randomUUID is unavailable', () => {
      const savedRandomUUID = (globalThis.crypto as Crypto & { randomUUID?: () => string }).randomUUID;
      // Temporarily hide randomUUID to exercise the fallback path.
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
      try {
        const result = parseAnnotationResponse(
          JSON.stringify({ annotations: [{ perspective: 'critique', quote: 'q', comment: 'c' }] }),
        );
        expect(result).toHaveLength(1);
        expect(result[0].id).toMatch(/^[\da-f-]{36}$/i); // fallback still produces a 36-char UUID
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: savedRandomUUID, configurable: true });
      }
    });

    it('drops annotations with invalid perspective or missing fields', () => {
      const raw = JSON.stringify({
        annotations: [
          { perspective: 'critique', quote: 'good', comment: 'ok' },
          { perspective: 'bogus', quote: 'bad', comment: 'no' },        // invalid perspective
          { perspective: 'flaw', quote: '', comment: 'empty quote' },    // empty quote
          { perspective: 'flaw', quote: 'no comment' },                  // missing comment
        ],
      });
      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(1);
      expect(result[0].perspective).toBe('critique');
    });

    it('returns empty array on malformed JSON', () => {
      expect(parseAnnotationResponse('not json')).toEqual([]);
      expect(parseAnnotationResponse('')).toEqual([]);
    });

    it('strips markdown ```json fences and parses the inner JSON', () => {
      const raw = '```json\n' + JSON.stringify({ annotations: [
        { perspective: 'critique', quote: 'q', comment: 'c' },
      ] }) + '\n```';
      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(1);
      expect(result[0].perspective).toBe('critique');
    });

    it('extracts the JSON object from surrounding prose', () => {
      const raw = '好的，以下是批注结果：\n' + JSON.stringify({ annotations: [
        { perspective: 'flaw', quote: 'q', comment: 'c' },
      ] }) + '\n希望对你有帮助。';
      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(1);
      expect(result[0].perspective).toBe('flaw');
    });

    it('strips fences AND ignores prose around them', () => {
      const raw = '好的：\n```json\n' + JSON.stringify({ annotations: [
        { perspective: 'counterpoint', quote: 'q', comment: 'c' },
      ] }) + '\n```\n以上。';
      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(1);
      expect(result[0].perspective).toBe('counterpoint');
    });
  });
});

describe('sw-annotation annotateChunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    annotationStore.apiKey = 'sk-test';
    annotationStore.modelName = 'deepseek-chat';
    __resetJsonModeFlag();
  });

  it('posts error when apiKey missing', async () => {
    annotationStore.apiKey = '';
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => (c[1] as Record<string, unknown>).type === 'error')).toBe(true);
  });

  it('posts error when modelName missing', async () => {
    annotationStore.modelName = '';
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    const errCall = calls.find((c) => (c[1] as Record<string, unknown>).type === 'error');
    expect(errCall).toBeTruthy();
    expect((errCall![1] as Record<string, unknown>).errorKey).toBe('error.noModelName');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts annotated result with parsed annotations on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ annotations: [
          { perspective: 'critique', quote: 'q', comment: 'c' },
        ] }) } }],
      }),
    );
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 2, chunkText: 'C' }, port);

    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    const annotated = calls.find((c) => (c[1] as Record<string, unknown>).type === 'annotated');
    expect(annotated).toBeTruthy();
    const payload = annotated![1] as { chunkIndex: number; annotations: Annotation[] };
    expect(payload.chunkIndex).toBe(2);
    expect(payload.annotations).toHaveLength(1);
    expect(payload.annotations[0].perspective).toBe('critique');
  });

  it('posts error when response not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => (c[1] as Record<string, unknown>).type === 'error')).toBe(true);
  });

  it('posts empty annotations when model returns empty array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ annotations: [] }) } }] }),
    );
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    const annotated = calls.find((c) => (c[1] as Record<string, unknown>).type === 'annotated');
    expect((annotated![1] as { annotations: unknown[] }).annotations).toEqual([]);
  });

  it('registers a disconnect listener (aborts on port disconnect)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 0, json: async () => ({}) } as unknown as Response);
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    expect(port.onDisconnect.addListener).toHaveBeenCalled();
    // removeListener is called in finally — cleanup happened
    expect(port.onDisconnect.removeListener).toHaveBeenCalled();
  });

  it('downgrades: retries without response_format when provider rejects json_object, then succeeds', async () => {
    // First call: 400 with response_format error → triggers downgrade retry.
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ error: { message: "json_object is not supported by this model" } }),
    } as unknown as Response);
    // Second call (no response_format): success.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ annotations: [
        { perspective: 'critique', quote: 'q', comment: 'c' },
      ] }) } }] }),
    );
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);

    // Two fetches happened: first with response_format, second without.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    expect(secondBody.response_format).toBeUndefined();
    // The annotated result was posted from the second (successful) call.
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    const annotated = calls.find((c) => (c[1] as Record<string, unknown>).type === 'annotated');
    expect(annotated).toBeTruthy();
  });

  it('after downgrade flag is set, subsequent chunks skip response_format on the first try', async () => {
    // Prime the flag by running one chunk that triggers the downgrade.
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ error: { message: "response_format json_object not supported" } }),
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ annotations: [] }) } }] }),
    );
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, mockPort());

    // Now a second chunk: only ONE fetch, and it must NOT have response_format.
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ annotations: [] }) } }] }),
    );
    await annotateChunk({ fullArticle: 'A', chunkIndex: 1, chunkText: 'D' }, mockPort());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toBeUndefined();
  });

  it('does not downgrade on a non-response_format 400 (surfaces the error directly)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ error: { message: "Invalid model id" } }),
    } as unknown as Response);
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    // No retry — only one fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    const errCall = calls.find((c) => (c[1] as Record<string, unknown>).type === 'error');
    expect(errCall).toBeTruthy();
    expect((errCall![1] as Record<string, unknown>).error).toBe('Invalid model id');
  });
});
