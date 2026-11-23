import { memo, useEffect, useRef } from 'react';
import { renderMarkdown } from '@/shared/markdown';
import { balanceFences } from '@/panel/lib/balance-fences';
import { jumpToParagraph } from '@/panel/lib/citations';
import { CITATION_MARKER_RE, insertCitationMarkers, safeHttpUrl } from '@/shared/web-search';
import type { WebResult, WebSource } from '@/shared/types';

/**
 * The one Markdown → DOM render path of the panel (marked + DOMPurify via
 * shared/markdown — answers are untrusted; see that module's header).
 * `[#N]` citation markers become clickable chips (event delegation, no
 * per-render listener churn).
 *
 * F15: with `web`, the answer's web citations become numbered source chips.
 * The private-use markers are inserted HERE, at render time only — the stored
 * Markdown stays clean, so copy / TTS / share / export never see them.
 */
export const MarkdownView = memo(function MarkdownView({ text, className = '', web }: { text: string; className?: string; web?: WebResult }) {
  const html = renderMarkdown(balanceFences(web ? insertCitationMarkers(text, web.citations) : text));
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Citation chips: after the sanitized HTML lands, turn EVERY [#N] marker
    // into a clickable chip. A paragraph typically carries several markers in
    // ONE text node ("结论A[#1]…结论B[#2]"), so each node is matchAll'd and
    // processed in REVERSE order (earlier splitText offsets stay valid).
    if (root.innerHTML.includes('[#')) {
      for (const node of textNodes(root)) {
        const text = node.textContent ?? '';
        const matches = [...text.matchAll(/\[#(\d{1,3})\]/g)];
        for (let i = matches.length - 1; i >= 0; i--) {
          const m = matches[i]!;
          const at = m.index ?? -1;
          if (at === -1) continue;
          const marker = m[0];
          const index = Number(m[1]);
          const after = node.splitText(at);
          after.splitText(marker.length);
          const btn = document.createElement('button');
          btn.className = 'citation-chip';
          btn.textContent = marker;
          btn.title = marker;
          btn.addEventListener('click', () => void jumpToParagraph(index));
          after.parentNode?.replaceChild(btn, after);
        }
      }
    }

    // F15: source chips, same technique. Markers are appended at the END of a
    // cited span and inserted right-to-left, so each node's markers sit
    // together; walking them in reverse keeps the split offsets valid.
    if (web?.sources.length) linkWebCitations(root, web.sources);
  }, [html, web]);

  return <div ref={ref} className={`md-body ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Every text node under `root`, in document order. */
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

/**
 * Replace each `\uE000<n>\uE001` marker with a numbered link to source n
 * (1-based). A source whose URL is not http(s) never becomes a link — the
 * URL arrives in the API response, and the DOM here is past sanitization.
 */
function linkWebCitations(root: HTMLElement, sources: WebSource[]): void {
  for (const node of textNodes(root)) {
    const text = node.textContent ?? '';
    const matches = [...text.matchAll(CITATION_MARKER_RE)];
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]!;
      const at = m.index;
      if (at === undefined) continue;
      const source = sources[Number(m[1]) - 1];
      const after = node.splitText(at);
      after.splitText(m[0].length);
      const link = source ? safeHttpUrl(source.url) : null;
      const el: HTMLElement = link ? document.createElement('a') : document.createElement('span');
      el.className = 'web-cite';
      el.textContent = m[1]!;
      if (source) el.title = source.title;
      if (link && el instanceof HTMLAnchorElement) {
        el.href = link;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
      after.parentNode?.replaceChild(el, after);
    }
  }
}
