import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));
const { loadPdfjs } = vi.hoisted(() => ({ loadPdfjs: vi.fn() }));
vi.mock('../../src/side_panel/services/pdf-loader', () => ({ loadPdfjs }));

import { extractPdf, servesPdf } from '../../src/side_panel/services/pdf-extractor';

function fakePdf(pages: { str: string; hasEOL?: boolean }[][], title?: string) {
  const destroy = vi.fn();
  return {
    destroy,
    pdfjs: {
      getDocument: vi.fn(() => ({
        destroy,
        promise: Promise.resolve({
          numPages: pages.length,
          getPage: async (i: number) => ({ getTextContent: async () => ({ items: pages[i - 1] }), cleanup: vi.fn() }),
          getMetadata: async () => ({ info: title ? { Title: title } : {} }),
        }),
      })),
    },
  };
}

function stubFetch(res: Partial<Response> | Error) {
  vi.stubGlobal('fetch', vi.fn(() => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res))));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('extractPdf', () => {
  it('reads every page into paragraphs, titled from metadata or the file name', async () => {
    stubFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    const { pdfjs, destroy } = fakePdf([[{ str: 'First page text.', hasEOL: true }], [{ str: 'Second page.' }]], 'Paper');
    loadPdfjs.mockResolvedValue(pdfjs);
    const res = await extractPdf('https://x.com/doc.pdf');
    expect(res.ok && res.value).toEqual({
      title: 'Paper',
      textContent: 'First page text.\n\nSecond page.',
      excerpt: 'First page text.\n\nSecond page.',
      paragraphs: ['First page text.', 'Second page.'],
    });
    expect(destroy).toHaveBeenCalled();

    loadPdfjs.mockResolvedValue(fakePdf([[{ str: 'x' }]]).pdfjs);
    const res2 = await extractPdf('https://x.com/My%20Notes.pdf');
    expect(res2.ok && res2.value.title).toBe('My Notes');
  });

  it('reports scans, download failures, file access and parse errors', async () => {
    stubFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    loadPdfjs.mockResolvedValue(fakePdf([[{ str: '  ' }]]).pdfjs);
    expect((await extractPdf('https://x.com/scan.pdf')).ok).toBe(false);

    stubFetch({ ok: false, status: 404 });
    const r404 = await extractPdf('https://x.com/a.pdf');
    expect(!r404.ok && r404.error.message).toBe('[error.pdfFetch]');

    stubFetch(new Error('denied'));
    const rFile = await extractPdf('file:///a.pdf');
    expect(!rFile.ok && rFile.error.message).toBe('[error.pdfFileAccess]');

    stubFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    loadPdfjs.mockRejectedValue(new Error('boom'));
    const rParse = await extractPdf('https://x.com/a.pdf');
    expect(!rParse.ok && rParse.error.message).toBe('[error.pdfParse]');
  });
});

describe('servesPdf', () => {
  it('checks the content type of http(s) URLs only', async () => {
    stubFetch({ headers: new Headers({ 'content-type': 'application/pdf; charset=binary' }) });
    expect(await servesPdf('https://x.com/download?id=1')).toBe(true);
    stubFetch({ headers: new Headers({ 'content-type': 'text/html' }) });
    expect(await servesPdf('https://x.com/')).toBe(false);
    expect(await servesPdf('chrome://newtab')).toBe(false);
    stubFetch(new Error('offline'));
    expect(await servesPdf('https://x.com/')).toBe(false);
  });
});
