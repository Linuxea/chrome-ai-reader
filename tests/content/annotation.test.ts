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
    expect(found).toBe(true);

    const mark = p.querySelector('mark.anno-mark');
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toBe('thirty percent');
  });

  it('wraps a quote spanning two adjacent text nodes', () => {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('The model improved perfor'));
    p.appendChild(document.createTextNode('mance by a lot.'));
    document.body.appendChild(p);

    const found = findAndWrap(p, 'performance');
    expect(found).toBe(true);
    expect(p.querySelector('mark.anno-mark')!.textContent).toBe('performance');
  });

  it('trims whitespace around the quote when locating', () => {
    const p = document.createElement('p');
    p.textContent = 'Some sentence.   performance is great here.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'performance is great')).toBe(true);
    expect(p.querySelector('mark.anno-mark')!.textContent).toBe('performance is great');
  });

  it('returns false and wraps nothing when quote not present', () => {
    const p = document.createElement('p');
    p.textContent = 'Nothing relevant here at all in this text.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'absent phrase')).toBe(false);
    expect(p.querySelector('mark.anno-mark')).toBeNull();
  });

  it('returns false for empty quote', () => {
    const p = document.createElement('p');
    p.textContent = 'Some real content text to test against here.';
    expect(findAndWrap(p, '')).toBe(false);
  });

  it('only wraps the first occurrence', () => {
    const p = document.createElement('p');
    p.textContent = 'great great great text that repeats the word great.';
    document.body.appendChild(p);

    expect(findAndWrap(p, 'great')).toBe(true);
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

    createIconFor(p, { id: 'a1', perspective: 'flaw', quote: 'Some', comment: 'comment body' }, onFollowUp);
    const icon = p.parentElement!.querySelector<HTMLButtonElement>('.anno-icon')!;
    icon.click();

    const root = getBubbleHost().shadowRoot!;
    const followBtn = root.querySelector<HTMLButtonElement>('.anno-followup')!;
    followBtn.click();
    expect(onFollowUp).toHaveBeenCalledWith('comment body');
  });
});

import { handleStartAnnotation, handleClearAnnotation, resetAnnotationState } from '../../src/content/annotation.js';

// --- chrome runtime mock for content orchestration ---
let postedRuntime: { action: string; [k: string]: unknown }[] = [];
const portListeners: ((msg: Record<string, unknown>) => void)[] = [];
function makePort() {
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (cb: (m: Record<string, unknown>) => void) => portListeners.push(cb),
      removeListener: (cb: (m: Record<string, unknown>) => void) => {
        const idx = portListeners.indexOf(cb);
        if (idx >= 0) portListeners.splice(idx, 1);
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

async function flushPorts(chunkIndex: number, annotations: Annotation[]): Promise<void> {
  for (const cb of portListeners) {
    cb({ type: 'annotated', chunkIndex, annotations });
  }
}

describe('content/annotation orchestration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    postedRuntime = [];
    portListeners.length = 0;
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
    await flushPorts(0, [{ id: 'a1', perspective: 'critique', quote: 'a quote that does not exist', comment: 'c' }]);
    await promise;
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('mark.anno-mark')).toBeNull();
  });

  it('clears all annotations on handleClearAnnotation', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    const promise = handleStartAnnotation();
    await flushPorts(0, [{ id: 'a1', perspective: 'flaw', quote: 'First paragraph', comment: 'c' }]);
    await promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.anno-icon')).toBeTruthy();

    handleClearAnnotation();
    expect(document.querySelector('mark.anno-mark')).toBeNull();
    expect(document.querySelector('.anno-icon')).toBeNull();
    expect(getBubbleHost().shadowRoot!.querySelector('.anno-bubble')).toBeNull();
  });

  it('reports failure to side panel when a chunk errors', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    const promise = handleStartAnnotation();
    for (const cb of portListeners) cb({ type: 'error', error: 'boom' });
    await promise;
    const actions = postedRuntime.map((m) => m.action);
    expect(actions).toContain('annotationFailed');
  });

  it('does not insert icons for an in-flight chunk that resolves after clear', async () => {
    document.body.innerHTML = `<article>
      <p>First paragraph with enough text to qualify as a content chunk one.</p>
      <p>Second paragraph with enough text to qualify as a content chunk two.</p>
    </article>`;
    const promise = handleStartAnnotation();
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
});
