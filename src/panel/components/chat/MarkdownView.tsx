import { memo, useEffect, useRef } from 'react';
import { renderMarkdown } from '@/shared/markdown';
import { balanceFences } from '@/panel/lib/balance-fences';
import { jumpToParagraph } from '@/panel/lib/citations';

/**
 * The one Markdown → DOM render path of the panel (marked + DOMPurify via
 * shared/markdown — answers are untrusted; see that module's header).
 * `[#N]` citation markers become clickable chips (event delegation, no
 * per-render listener churn).
 */
export const MarkdownView = memo(function MarkdownView({ text, className = '' }: { text: string; className?: string }) {
  const html = renderMarkdown(balanceFences(text));
  const ref = useRef<HTMLDivElement | null>(null);

  // Citation chips: after the sanitized HTML lands, turn EVERY [#N] marker
  // into a clickable chip. A paragraph typically carries several markers in
  // ONE text node ("结论A[#1]…结论B[#2]"), so each node is matchAll'd and
  // processed in REVERSE order (earlier splitText offsets stay valid).
  useEffect(() => {
    const root = ref.current;
    if (!root || !root.innerHTML.includes('[#')) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

    for (const node of nodes) {
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
  }, [html]);

  return <div ref={ref} className={`md-body ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
