/**
 * Tests for side_panel/ui/share-card.ts — F14 share card construction.
 *
 * Pure-DOM module: structure, conditional blocks (E-04/E-05), accent/theme
 * injection (R-03/AC-04), the E-01 truncation cascade, and the sanitize
 * re-check on the rendered markdown. Plus two non-DOM guards:
 * - R-07: every new i18n key exists in BOTH zh and en (no missed translations);
 * - CSS regression: share.css must define `.share-modal.hidden` explicitly —
 *   there is no global `.hidden` utility, so a missing rule leaves the modal
 *   permanently visible (same trap as tests/side_panel/features/tab-context).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// i18n.js registers chrome.storage.onChanged at module load — chrome must be
// on globalThis BEFORE the import (same pattern as tests/shared/i18n.test.ts).
vi.hoisted(() => {
  globalThis.chrome = {
    storage: {
      sync: {
        get: (_keys: unknown, cb?: (data: Record<string, unknown>) => void) => cb?.({}),
        set: () => {},
      },
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
  } as unknown as typeof chrome;
});

import { t, setLanguage } from '../../../src/shared/i18n.js';
import {
  buildShareCard,
  fitShareCard,
  truncateMarkdown,
  SHARE_CARD_WIDTH,
  SHARE_CARD_NARROW_WIDTH,
  MAX_CARD_HEIGHT,
  SOFT_CHAR_LIMIT,
  type ShareCardData,
} from '../../../src/side_panel/ui/share-card';

function baseData(overrides: Partial<ShareCardData> = {}): ShareCardData {
  return {
    question: 'What is this page about?',
    pageTitle: 'The Design Doc',
    date: '2026-11-09',
    accent: '#3a7bd5',
    markdown: '# Answer\n\nSome **bold** claim.',
    ...overrides,
  };
}

describe('ui/share-card — structure (AC-01, R-02)', () => {
  beforeEach(() => {
    setLanguage('zh');
    document.body.innerHTML = '';
  });

  it('renders header (brand + date), source, question, body and watermark', () => {
    const el = buildShareCard(baseData());

    expect(el.classList.contains('share-card')).toBe(true);
    // foreignObject needs a valid XHTML subtree
    expect(el.getAttribute('xmlns')).toBe('http://www.w3.org/1999/xhtml');

    expect(el.querySelector('.share-card-brand')!.textContent).toBe(t('app.fullName'));
    expect(el.querySelector('.share-card-date')!.textContent).toBe('2026-11-09');
    expect(el.querySelector('.share-card-source')!.textContent).toBe(t('share.source', { title: 'The Design Doc' }));

    const q = el.querySelector('.share-card-question')!;
    expect(q.textContent).toContain('What is this page about?');
    expect(q.querySelector('.share-card-q')!.textContent).toBe('Q');

    // markdown went through renderMarkdown (h1 + strong, not raw text)
    const body = el.querySelector('.share-card-body')!;
    expect(body.querySelector('h1')).toBeTruthy();
    expect(body.querySelector('strong')!.textContent).toBe('bold');

    expect(el.querySelector('.share-card-footer')!.textContent).toBe(t('share.watermark', { app: t('app.fullName') }));
    // fully styled standalone — the inline <style> block is inside the card
    expect(el.querySelector(':scope > style')).toBeTruthy();
    // no truncation footnote for a short answer
    expect(el.querySelector('.share-card-truncated')).toBeNull();
  });

  it('sanitizes hostile markdown (script stripped, remote image never fetched)', () => {
    const el = buildShareCard(baseData({
      markdown: 'Text\n\n<script>alert(1)</script>\n\n![leak](http://evil.example/x.jpg)',
    }));
    const body = el.querySelector('.share-card-body')!;
    expect(body.querySelectorAll('script')).toHaveLength(0);
    // remote images become links (renderMarkdown contract) — no img src fetch
    const remote = Array.from(body.querySelectorAll('img')).filter((i) => (i.getAttribute('src') || '').startsWith('http'));
    expect(remote).toHaveLength(0);
  });

  it('keeps [#N] citations as plain text (no linkifyCitations)', () => {
    const el = buildShareCard(baseData({ markdown: 'Claim one [#3] stays text.' }));
    const body = el.querySelector('.share-card-body')!;
    expect(body.textContent).toContain('[#3]');
    expect(body.querySelector('.citation-chip, a[data-citation]')).toBeNull();
  });
});

describe('ui/share-card — theming (AC-04, R-03)', () => {
  beforeEach(() => setLanguage('zh'));

  it('injects the accent color into the inline card style', () => {
    const el = buildShareCard(baseData({ accent: '#ff00aa' }));
    const style = el.querySelector(':scope > style')!.textContent!;
    expect(style).toContain('#ff00aa'); // top bar / question border / quote bar
  });

  it('uses a fixed light background regardless of the active page theme', () => {
    // simulate a dark theme on the host document — the card style must not depend on it
    document.documentElement.setAttribute('data-theme', 'dark');
    const el = buildShareCard(baseData());
    const style = el.querySelector(':scope > style')!.textContent!;
    expect(style).toMatch(/background:\s*#ffffff/);
    expect(style).not.toContain('var(--');
  });
});

describe('ui/share-card — conditional blocks (E-04, E-05)', () => {
  beforeEach(() => setLanguage('zh'));

  it('omits the source line when pageTitle is empty or missing', () => {
    expect(buildShareCard(baseData({ pageTitle: '' })).querySelector('.share-card-source')).toBeNull();
    expect(buildShareCard(baseData({ pageTitle: undefined })).querySelector('.share-card-source')).toBeNull();
    expect(buildShareCard(baseData({ pageTitle: '  ' })).querySelector('.share-card-source')).toBeNull();
  });

  it('omits the question block when there is no preceding user bubble', () => {
    expect(buildShareCard(baseData({ question: undefined })).querySelector('.share-card-question')).toBeNull();
    expect(buildShareCard(baseData({ question: '   ' })).querySelector('.share-card-question')).toBeNull();
  });
});

describe('ui/share-card — truncation (AC-05, E-01)', () => {
  beforeEach(() => setLanguage('zh'));

  it('truncateMarkdown keeps whole paragraphs and stops at the limit', () => {
    const paragraphs = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} with a few words inside.`);
    const md = paragraphs.join('\n\n');
    const { text, truncated } = truncateMarkdown(md, 1000);

    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(1000);
    // whole-paragraph prefix — never a half-open fence/list/table
    const kept = text.split('\n\n').length;
    expect(text).toBe(paragraphs.slice(0, kept).join('\n\n'));
  });

  it('truncateMarkdown leaves short input untouched', () => {
    const { text, truncated } = truncateMarkdown('short\n\nanswer', SOFT_CHAR_LIMIT);
    expect(text).toBe('short\n\nanswer');
    expect(truncated).toBe(false);
  });

  it('fitShareCard keeps 720px and full text when the card fits', () => {
    const measure = vi.fn(() => 900);
    const fitted = fitShareCard(baseData({ markdown: 'compact answer' }), measure);
    expect(fitted.width).toBe(SHARE_CARD_WIDTH);
    expect(fitted.el.style.width).toBe(`${SHARE_CARD_WIDTH}px`);
    expect(fitted.truncated).toBe(false);
    expect(fitted.el.querySelector('.share-card-truncated')).toBeNull();
    expect(fitted.el.querySelector('.share-card-body')!.textContent).toContain('compact answer');
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('fitShareCard falls back to 560px when 720px exceeds the canvas ceiling', () => {
    let calls = 0;
    const fitted = fitShareCard(baseData({ markdown: 'a'.repeat(8000) }), () => {
      calls += 1;
      return calls === 1 ? MAX_CARD_HEIGHT + 1 : 500;
    });
    expect(fitted.width).toBe(SHARE_CARD_NARROW_WIDTH);
    expect(fitted.truncated).toBe(false); // 8000 chars is under the soft limit — no cut needed
  });

  it('fitShareCard hard-cuts with a footnote when even 560px overflows', () => {
    const fitted = fitShareCard(baseData({ markdown: 'x'.repeat(8000) }), () => MAX_CARD_HEIGHT + 1);
    expect(fitted.width).toBe(SHARE_CARD_NARROW_WIDTH);
    expect(fitted.truncated).toBe(true);
    expect(fitted.el.querySelector('.share-card-truncated')!.textContent).toBe(t('share.truncated'));
    const rendered = fitted.el.querySelector('.share-card-body')!.textContent || '';
    expect(rendered.length).toBeLessThanOrEqual(8000);
    expect(rendered.length).toBeGreaterThan(0);
  });
});

describe('i18n — F14 keys exist in both languages (R-07, AC-06)', () => {
  const KEYS = [
    'action.shareImage',
    'share.previewTitle',
    'share.download',
    'share.copyImage',
    'share.copied',
    'share.failed',
    'share.source',
    'share.truncated',
    'share.generating',
    'share.watermark',
    'share.filePrefix',
  ];

  it.each(KEYS)('%s resolves in zh', (key) => {
    setLanguage('zh');
    expect(t(key)).not.toBe(key);
  });

  it.each(KEYS)('%s resolves in en', (key) => {
    setLanguage('en');
    expect(t(key)).not.toBe(key);
  });

  it('interpolates the source and watermark placeholders', () => {
    setLanguage('en');
    expect(t('share.source', { title: 'Wiki' })).toContain('Wiki');
    expect(t('share.watermark', { app: 'PearReader' })).toContain('PearReader');
  });
});

describe('share.css regression (no global .hidden utility — AC-07)', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/side_panel/share.css'), 'utf8');

  it('.share-modal.hidden hides the modal — without this rule it never visually closes', () => {
    expect(css).toMatch(/\.share-modal\.hidden\s*\{\s*display:\s*none/);
  });

  it('.share-image-btn has its own rule (the share button is styled, not inherited)', () => {
    expect(css).toMatch(/\.share-image-btn\s*\{/);
  });
});
