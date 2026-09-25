import { vi, describe, it, expect, beforeEach } from 'vitest';

const { ports } = vi.hoisted(() => ({ ports: [] as { posted: unknown[]; listeners: ((m: unknown) => void)[]; disconnect: () => void }[] }));
vi.mock('../../src/platform/ports', () => ({
  openTranslatePort: () => {
    const p = { posted: [] as unknown[], listeners: [] as ((m: unknown) => void)[], disconnect: vi.fn(),
      postMessage(m: unknown) { this.posted.push(m); },
      onMessage: { addListener(f: (m: unknown) => void) { p.listeners.push(f); } },
      onDisconnect: { addListener: vi.fn() } };
    ports.push(p);
    return p;
  },
}));
vi.mock('../../src/content/annotation-meta', () => ({ getUiLang: () => 'zh' }));

import { needsTranslation, collectTranslatable, toggleImmersive, isImmersiveActive, clearImmersive } from '../../src/content/immersive';

beforeEach(() => {
  ports.length = 0;
  clearImmersive();
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } });
  document.body.innerHTML = '<article><h2>Title here</h2><p>First English paragraph.</p><p>已经是中文的段落。</p><ul><li>List item text</li></ul></article>';
});

describe('content/immersive', () => {
  it('skips paragraphs already in the target language', () => {
    expect(needsTranslation('Hello world', 'zh')).toBe(true);
    expect(needsTranslation('你好世界', 'zh')).toBe(false);
    expect(needsTranslation('你好世界', 'en')).toBe(true);
    expect(collectTranslatable().map((e) => e.textContent)).toEqual(['Title here', 'First English paragraph.', 'List item text']);
  });

  it('inserts translations under paragraphs (inside list items) and removes them on toggle off', async () => {
    const run = toggleImmersive();
    await vi.waitFor(() => expect(ports[0]?.posted.length).toBe(1));
    const req = ports[0].posted[0] as { id: number; texts: string[] };
    expect(req.texts).toEqual(['Title here', 'First English paragraph.', 'List item text']);
    ports[0].listeners.forEach((f) => f({ type: 'translated', id: req.id, translations: ['标题', '第一段', '列表项'] }));
    await run;
    const tr = [...document.querySelectorAll('.ai-reader-translation')].map((e) => e.textContent);
    expect(tr).toEqual(['标题', '第一段', '列表项']);
    expect(document.querySelector('li .ai-reader-translation')).not.toBeNull();
    expect(isImmersiveActive()).toBe(true);

    await toggleImmersive();
    expect(document.querySelectorAll('.ai-reader-translation')).toHaveLength(0);
    expect(isImmersiveActive()).toBe(false);
  });
});
