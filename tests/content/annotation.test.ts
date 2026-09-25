import { vi, describe, it, expect, beforeEach } from 'vitest';
import { collectChunks, type CollectedChunk } from '../../src/content/annotation.js';

describe('content/annotation collectChunks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('collects <p> elements inside <article> as chunks in order', () => {
    document.body.innerHTML = `
      <article>
        <p>First paragraph with enough text to be considered content here.</p>
        <p>Second paragraph also has a good amount of text in it too.</p>
      </article>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain('First paragraph');
    expect(chunks[1].text).toContain('Second paragraph');
    expect(chunks[0].node.tagName).toBe('P');
  });

  it('prefers article/main/[role=main] containers, ignoring nav/footer/script', () => {
    document.body.innerHTML = `
      <nav><p>navigation text that should be ignored completely</p></nav>
      <main>
        <p>Main content paragraph one with enough text to qualify.</p>
        <p>Main content paragraph two with enough text as well here.</p>
      </main>
      <footer><p>footer text that should also be ignored here.</p></footer>
      <script>p('not real text')</script>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.text.startsWith('Main content'))).toBe(true);
  });

  it('skips paragraphs shorter than the minimum length', () => {
    document.body.innerHTML = `
      <article>
        <p>too short.</p>
        <p>This paragraph is long enough to be picked up as real content yes.</p>
      </article>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('long enough');
  });

  it('falls back to body paragraphs when no semantic container exists', () => {
    document.body.innerHTML = `
      <p>Standalone paragraph with enough text to count as content ok.</p>
    `;
    const chunks = collectChunks(document);
    expect(chunks).toHaveLength(1);
  });

  it('produces empty list for a document with no paragraphs', () => {
    document.body.innerHTML = `<div>just a div</div>`;
    expect(collectChunks(document)).toEqual([]);
  });
});

import { findAndWrap } from '../../src/content/annotation.js';

describe('content/annotation findAndWrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('wraps an exact quote in a single text node', () => {
    const p = document.createElement('p');
    p.textContent = 'The model improved performance by thirty percent overall.';
    document.body.appendChild(p);

    const found = findAndWrap(p, 'thirty percent');
    expect(found).toBeInstanceOf(HTMLElement);
    expect(found!.className).toBe('anno-mark');
    expect(found!.textContent).toBe('thirty percent');
  });

  it('wraps a quote spanning two adjacent text nodes', () => {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('The model improved perfor'));
    p.appendChild(document.createTextNode('mance by a lot.'));
    document.body.appendChild(p);

    const found = findAndWrap(p, 'performance');
    expect(found).toBeInstanceOf(HTMLElement);
    expect(p.querySelector('mark.anno-mark')!.textContent).toBe('performance');
  });

  it('trims whitespace around the quote when locating', () => {
    const p = document.createElement('p');
    p.textContent = 'Some sentence.   performance is great here.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'performance is great')).toBeInstanceOf(HTMLElement);
    expect(p.querySelector('mark.anno-mark')!.textContent).toBe('performance is great');
  });

  it('returns null and wraps nothing when quote not present', () => {
    const p = document.createElement('p');
    p.textContent = 'Nothing relevant here at all in this text.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'absent phrase')).toBeNull();
    expect(p.querySelector('mark.anno-mark')).toBeNull();
  });

  it('returns false for empty quote', () => {
    const p = document.createElement('p');
    p.textContent = 'Some real content text to test against here.';
    expect(findAndWrap(p, '')).toBeNull();
  });

  it('only wraps the first occurrence', () => {
    const p = document.createElement('p');
    p.textContent = 'great great great text that repeats the word great.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'great')).toBeInstanceOf(HTMLElement);
    expect(p.querySelectorAll('mark.anno-mark')).toHaveLength(1);
  });
});

import { createIconFor, getBubbleHost, type IconHandle } from '../../src/content/annotation.js';

describe('content/annotation bubbles', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // reset bubble host singleton between tests
    getBubbleHost(true);
  });

  it('creates a clickable icon button with the perspective class', () => {
    const p = document.createElement('p');
    p.textContent = 'Some content paragraph that is long enough to be a chunk here.';
    document.body.appendChild(p);

    const handle = createIconFor(p, {
      id: 'a1',
      perspective: 'critique',
      quote: 'Some content',
      comment: 'This is the critique comment.',
    });

    expect(handle.button.classList.contains('anno-icon')).toBe(true);
    expect(handle.button.classList.contains('anno-icon-critique')).toBe(true);
  });

  it('places the icon immediately after the highlighted <mark>, not at paragraph end', () => {
    const p = document.createElement('p');
    p.textContent = 'Before highlight. The quoted phrase here. After highlight trailing text.';
    document.body.appendChild(p);

    // Wrap a phrase in the middle of the paragraph.
    const mark = findAndWrap(p, 'The quoted phrase');
    expect(mark).toBeInstanceOf(HTMLElement);
    // Anchor the icon to the mark (as the orchestration does).
    createIconFor(mark!, { id: 'a1', perspective: 'critique', quote: 'The quoted phrase', comment: 'c' });

    // The icon must be the mark's immediate next sibling — i.e. the icon sits
    // right after "The quoted phrase", not appended after the whole paragraph.
    expect(mark!.nextElementSibling).toBe(document.querySelector('.anno-icon'));
  });

  it('opens a bubble on icon click and closes on a second outside click', () => {
    const p = document.createElement('p');
    p.textContent = 'Some content paragraph that is long enough to be a chunk here.';
    document.body.appendChild(p);

    createIconFor(p, {
      id: 'a1',
      perspective: 'flaw',
      quote: 'Some content',
      comment: 'A logic flaw comment here.',
    });

    const icon = p.parentElement!.querySelector<HTMLButtonElement>('.anno-icon')!;

    // jsdom: click the icon
    icon.click();

    const host = getBubbleHost();
    const root = host.shadowRoot!;
    const bubble = root.querySelector('.anno-bubble') as HTMLElement | null;
    expect(bubble).toBeTruthy();
    expect(bubble!.querySelector('.anno-comment')!.textContent).toContain('A logic flaw comment');

    // click elsewhere closes it
    document.body.click();
    expect(root.querySelector('.anno-bubble')).toBeNull();
  });

  it('only one bubble open at a time', () => {
    const p1 = document.createElement('p');
    p1.textContent = 'First content paragraph long enough to be a chunk ok.';
    const p2 = document.createElement('p');
    p2.textContent = 'Second content paragraph long enough to be a chunk ok.';
    document.body.appendChild(p1);
    document.body.appendChild(p2);

    const h1 = createIconFor(p1, { id: 'a1', perspective: 'critique', quote: 'First', comment: 'c1' });
    const h2 = createIconFor(p2, { id: 'a2', perspective: 'counterpoint', quote: 'Second', comment: 'c2' });

    h1.button.click();
    const root = getBubbleHost().shadowRoot!;
    expect(root.querySelectorAll('.anno-bubble')).toHaveLength(1);

    h2.button.click();
    expect(root.querySelectorAll('.anno-bubble')).toHaveLength(1);
    expect(root.querySelector('.anno-comment')!.textContent).toContain('c2');
  });

  it('invokes the follow-up callback when the follow-up button is clicked', () => {
    const onFollowUp = vi.fn();
    const p = document.createElement('p');
    p.textContent = 'Some content paragraph that is long enough to be a chunk here.';
    document.body.appendChild(p);

    const ann = { id: 'a1', perspective: 'flaw' as const, quote: 'Some', comment: 'comment body' };
    createIconFor(p, ann, onFollowUp);
    const icon = p.parentElement!.querySelector<HTMLButtonElement>('.anno-icon')!;
    icon.click();

    const root = getBubbleHost().shadowRoot!;
    const followBtn = root.querySelector<HTMLButtonElement>('.anno-followup')!;
    followBtn.click();
    // The callback receives the full annotation (quote + comment), so the
    // panel can show the source sentence as the quote preview.
    expect(onFollowUp).toHaveBeenCalledWith(ann);
  });
});

import { handleStartAnnotation, handleClearAnnotation, resetAnnotationState } from '../../src/content/annotation.js';

// --- chrome runtime mock for content orchestration ---
let postedRuntime: { action: string; [k: string]: unknown }[] = [];
// Each port keeps its OWN listener list (mirrors real SW: a response is sent
// back only on the port that requested it). `portListenerSets` is indexed by
// connection order, so flushPorts(k, ...) targets the k-th opened port.
let portListenerSets: ((msg: Record<string, unknown>) => void)[][] = [];
function makePort() {
  const listeners: ((m: Record<string, unknown>) => void)[] = [];
  portListenerSets.push(listeners);
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (cb: (m: Record<string, unknown>) => void) => listeners.push(cb),
      removeListener: (cb: (m: Record<string, unknown>) => void) => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      },
    },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
  };
}
vi.stubGlobal('chrome', {
  runtime: {
    connect: vi.fn(() => makePort()),
    sendMessage: vi.fn((msg: Record<string, unknown>) => { postedRuntime.push(msg as { action: string }); }),
    id: 'test-ext',
  },
});

/** Let the run get past its (async) cache lookup to the chunk requests. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Deliver an `annotated` message to the k-th opened port's listeners only. */
async function flushPorts(chunkIndex: number, annotations: Annotation[]): Promise<void> {
  const set = portListenerSets[chunkIndex] || [];
  for (const cb of set) {
    cb({ type: 'annotated', chunkIndex, annotations });
  }
}

/** Deliver an `error` message to the k-th opened port's listeners only. */
function flushError(chunkIndex: number): void {
  const set = portListenerSets[chunkIndex] || [];
  for (const cb of set) cb({ type: 'error', error: 'boom' });
}

describe('content/annotation orchestration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    postedRuntime = [];
    portListenerSets = [];
    resetAnnotationState();
    getBubbleHost(true);
    (chrome.runtime.connect as ReturnType<typeof vi.fn>).mockClear();
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();
  });

  it('collects chunks, requests each via port, and reports progress + done', async () => {
    document.body.innerHTML = `
      <article>
        <p>First paragraph with enough text to qualify as a content chunk one.</p>
        <p>Second paragraph with enough text to qualify as a content chunk two.</p>
      </article>
    `;

    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    // simulate background responses for both chunks
    await flushPorts(0, [{ id: 'a1', perspective: 'critique', quote: 'First paragraph', comment: 'c1' }]);
    await flushPorts(1, []);
    await promise;

    // progress + done reported to side panel
    const actions = postedRuntime.map((m) => m.action);
    expect(actions).toContain('annotationProgress');
    expect(actions).toContain('annotationDone');
    const done = postedRuntime.find((m) => m.action === 'annotationDone') as { count: number };
    expect(done.count).toBe(1); // only one annotation produced
  });

  it('highlights a matching quote and inserts an icon', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    await flushPorts(0, [{ id: 'a1', perspective: 'flaw', quote: 'First paragraph', comment: 'c' }]);
    await promise;
    // allow microtasks
    await new Promise((r) => setTimeout(r, 0));

    const p = document.querySelector('p')!;
    expect(p.querySelector('mark.anno-mark')).toBeTruthy();
    expect(document.querySelector('.anno-icon')).toBeTruthy();
  });

  it('degrades gracefully when quote not found (no mark, but still no crash)', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    await flushPorts(0, [{ id: 'a1', perspective: 'critique', quote: 'a quote that does not exist', comment: 'c' }]);
    await promise;
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('mark.anno-mark')).toBeNull();
  });

  it('clears all annotations on handleClearAnnotation', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    await flushPorts(0, [{ id: 'a1', perspective: 'flaw', quote: 'First paragraph', comment: 'c' }]);
    await promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.anno-icon')).toBeTruthy();

    handleClearAnnotation();
    expect(document.querySelector('mark.anno-mark')).toBeNull();
    expect(document.querySelector('.anno-icon')).toBeNull();
    expect(getBubbleHost().shadowRoot!.querySelector('.anno-bubble')).toBeNull();
  });

  it('reports terminal annotationFailed with the real error when every chunk fails', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    flushError(0);
    await promise;
    const failed = postedRuntime.find((m) => m.action === 'annotationFailed') as { error?: string };
    expect(failed).toBeTruthy();
    expect(failed.error).toBe('boom');
    // No annotationDone should be sent when all chunks failed.
    expect(postedRuntime.some((m) => m.action === 'annotationDone')).toBe(false);
  });

  it('reports annotationDone with failed count on partial failure (some succeed, some error)', async () => {
    document.body.innerHTML = `<article>
      <p>First paragraph with enough text to qualify as a content chunk one.</p>
      <p>Second paragraph with enough text to qualify as a content chunk two.</p>
    </article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    await flushPorts(0, [{ id: 'a1', perspective: 'critique', quote: 'First paragraph', comment: 'c1' }]);
    flushError(1);
    await promise;
    const done = postedRuntime.find((m) => m.action === 'annotationDone') as { count: number; failed?: number };
    expect(done).toBeTruthy();
    expect(done.count).toBe(1);
    expect(done.failed).toBe(1);
    // No terminal annotationFailed — not all chunks failed.
    expect(postedRuntime.some((m) => m.action === 'annotationFailed')).toBe(false);
  });

  it('does not insert icons for an in-flight chunk that resolves after clear', async () => {
    document.body.innerHTML = `<article>
      <p>First paragraph with enough text to qualify as a content chunk one.</p>
      <p>Second paragraph with enough text to qualify as a content chunk two.</p>
    </article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    // Resolve chunk 0, then clear BEFORE chunk 1 resolves.
    await flushPorts(0, [{ id: 'a1', perspective: 'flaw', quote: 'First paragraph', comment: 'c' }]);
    handleClearAnnotation();
    // Now chunk 1's port finally responds — it must not insert a late icon.
    await flushPorts(1, [{ id: 'a2', perspective: 'critique', quote: 'Second paragraph', comment: 'c2' }]);
    await promise;
    await new Promise((r) => setTimeout(r, 0));

    // Only the chunk-0 mark should have existed; after clear, nothing remains.
    expect(document.querySelectorAll('mark.anno-mark')).toHaveLength(0);
    expect(document.querySelectorAll('.anno-icon')).toHaveLength(0);
  });

  it('clear settles every in-flight request — the cancelled run finishes without any port reply', async () => {
    document.body.innerHTML = `<article>
      <p>First paragraph with enough text to qualify as a content chunk one.</p>
      <p>Second paragraph with enough text to qualify as a content chunk two.</p>
    </article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    const ports = (chrome.runtime.connect as ReturnType<typeof vi.fn>).mock.results.map(r => r.value);
    expect(ports).toHaveLength(2);

    handleClearAnnotation();

    // A port's own disconnect() never fires its onDisconnect, so the run must
    // not depend on it: it settles with no further messages at all.
    const settled = await Promise.race([
      promise.then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('hung'), 50)),
    ]);
    expect(settled).toBe('settled');
    for (const port of ports) expect(port.disconnect).toHaveBeenCalled();
    expect(postedRuntime.some((m) => m.action === 'annotationDone' || m.action === 'annotationFailed')).toBe(false);
  });

  it('a run started right after clear is not ended by the cancelled run', async () => {
    document.body.innerHTML = `<article>
      <p>First paragraph with enough text to qualify as a content chunk one.</p>
    </article>`;
    const first = handleStartAnnotation();
    await settle(); // first run has opened its chunk port (index 0)
    handleClearAnnotation();
    const second = handleStartAnnotation();
    await first;
    await settle(); // second run's port is index 1

    await flushPorts(1, [{ id: 'b1', perspective: 'flaw', quote: 'First paragraph', comment: 'c' }]);
    await second;

    const done = postedRuntime.filter((m) => m.action === 'annotationDone') as { count: number }[];
    expect(done).toHaveLength(1);
    expect(done[0].count).toBe(1);
    expect(document.querySelectorAll('.anno-icon')).toHaveLength(1);
  });

  it('replays a cached run for the same page text without calling the model', async () => {
    document.body.innerHTML = `<article>
      <p>First paragraph with enough text to qualify as a content chunk one.</p>
    </article>`;
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementationOnce(async (msg: { action: string }) => {
      postedRuntime.push(msg as { action: string });
      return { success: true, entry: { key: 'k', createdAt: 1, results: [
        { chunkIndex: 0, annotations: [{ id: 'c1', perspective: 'critique', quote: 'First paragraph', comment: 'cached' }] },
      ] } };
    });
    await handleStartAnnotation();
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.anno-icon')).toHaveLength(1);
    expect(postedRuntime.find((m) => m.action === 'annotationDone')).toMatchObject({ count: 1, cached: true });
  });

  it('saves a complete run to the cache, keyed by URL + text hash', async () => {
    document.body.innerHTML = `<article>
      <p>First paragraph with enough text to qualify as a content chunk one.</p>
    </article>`;
    const promise = handleStartAnnotation();
    await settle();
    await flushPorts(0, []);
    await promise;
    const save = postedRuntime.find((m) => m.action === 'annotations:save') as { key: string; results: unknown[] } | undefined;
    expect(save?.key).toMatch(/^http:\/\/localhost:3000\|[0-9a-f]{8}$/);
    expect(save?.results).toEqual([{ chunkIndex: 0, annotations: [] }]);
  });

  it('annotates multiple chunks concurrently (bounded pool) and aggregates counts', async () => {
    document.body.innerHTML = `<article>
      <p>Chunk zero paragraph with enough text to qualify as content one.</p>
      <p>Chunk one paragraph with enough text to qualify as content two.</p>
      <p>Chunk two paragraph with enough text to qualify as content three.</p>
      <p>Chunk three paragraph with enough text to qualify as content four.</p>
    </article>`;
    const promise = handleStartAnnotation();
    await settle(); // the annotation-cache lookup runs before any chunk port opens
    // All four chunks are requested concurrently; flush them in any order.
    await flushPorts(0, [{ id: 'a1', perspective: 'critique', quote: 'Chunk zero', comment: 'c' }]);
    await flushPorts(1, [{ id: 'a2', perspective: 'flaw', quote: 'Chunk one', comment: 'c' }]);
    await flushPorts(2, [{ id: 'a3', perspective: 'counterpoint', quote: 'Chunk two', comment: 'c' }]);
    await flushPorts(3, []); // no annotations on chunk 3
    await promise;
    await new Promise((r) => setTimeout(r, 0));

    // 3 annotations produced across the 4 chunks.
    const done = postedRuntime.find((m) => m.action === 'annotationDone') as { count: number };
    expect(done.count).toBe(3);
    expect(document.querySelectorAll('.anno-icon')).toHaveLength(3);
  });
});
