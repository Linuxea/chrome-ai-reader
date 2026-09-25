/**
 * Citation chips: answers cite page paragraphs as "[#N]" (citations.rule
 * prompt, labels from context-builder). After rendering, each "[#N]" in the
 * answer's text becomes a small chip; clicking one scrolls the page to that
 * paragraph (wired by features/citations.ts through the CITATION_CLICK event).
 *
 * Only text nodes are touched — never code, pre or existing links — and chips
 * are built with DOM APIs, so nothing from the model reaches innerHTML here.
 */

import { emit, EVENTS } from '../events';

const CITE = /\[#(\d{1,5})\]/g;

export function linkifyCitations(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!CITE.test(node.nodeValue ?? '')) return NodeFilter.FILTER_REJECT;
      CITE.lastIndex = 0;
      return (node.parentElement?.closest('code, pre, a, .cite-chip') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT);
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    CITE.lastIndex = 0;
    for (let m = CITE.exec(value); m; m = CITE.exec(value)) {
      if (m.index > last) frag.append(value.slice(last, m.index));
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cite-chip';
      chip.dataset.cite = m[1];
      chip.textContent = m[1];
      frag.append(chip);
      last = m.index + m[0].length;
    }
    if (last < value.length) frag.append(value.slice(last));
    node.replaceWith(frag);
  }
}

/** One delegated listener on the chat area turns chip clicks into CITATION_CLICK events. */
export function bindCitationClicks(chatArea: HTMLElement): void {
  chatArea.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>('.cite-chip');
    if (!chip) return;
    e.preventDefault();
    emit(EVENTS.CITATION_CLICK, { index: Number(chip.dataset.cite) });
  });
}
