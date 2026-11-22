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

  // Citation chips: after the sanitized HTML lands, wrap [#N] text nodes.
  useEffect(() => {
    const root = ref.current;
    if (!root || !root.innerHTML.includes('[#')) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: { node: Text; marker: string; index: number }[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const textNode = n as Text;
      const m = /\[#(\d{1,3})\]/.exec(textNode.textContent ?? '');
      if (m) targets.push({ node: textNode, marker: m[0], index: Number(m[1]) });
    }
    for (const { node, marker, index } of targets) {
      const at = (node.textContent ?? '').indexOf(marker);
      if (at === -1) continue;
      const after = node.splitText(at);
      after.splitText(marker.length);
      const btn = document.createElement('button');
      btn.className = 'citation-chip';
      btn.textContent = marker;
      btn.title = marker;
      btn.addEventListener('click', () => void jumpToParagraph(index));
      after.parentNode?.replaceChild(btn, after);
    }
  }, [html]);

  return <div ref={ref} className={`md-body ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
