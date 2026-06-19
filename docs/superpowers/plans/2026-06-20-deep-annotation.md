# 深度批阅（Deep Annotation）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a「深度批阅」button to the side panel that, on click, scans the current page's main text and renders AI-generated deep-perspective annotations (critique / counterpoint / flaw) as highlights with click-to-open bubbles on the page.

**Architecture:** Three-layer separation mirroring existing patterns. (1) Side panel feature `src/side_panel/features/annotation.ts` owns the button + state machine + progress listeners. (2) Content module `src/content/annotation.ts` collects paragraph chunks, requests per-chunk annotations via a `chrome.runtime.connect('annotation')` port, highlights quotes in the live DOM, and renders Shadow-DOM-isolated bubbles. (3) Background handler `src/background/sw-annotation.ts` assembles the Chinese system+user prompt and does a non-streaming OpenAI call with `response_format: json_object`, returning structured `Annotation[]` per chunk.

**Tech Stack:** TypeScript (strict), Chrome Extension MV3, Vitest + jsdom, Shadow DOM, OpenAI-compatible chat completions API.

**Spec:** `docs/superpowers/specs/2026-06-20-deep-annotation-design.md`

---

## File Structure

**New files:**
- `src/shared/types.ts` (modify) — add `AnnotationPerspective`, `Annotation`, `AnnotationResult`
- `src/background/sw-annotation.ts` — prompt assembly + non-streaming JSON OpenAI call over port
- `src/content/annotation.ts` — chunk collection, per-chunk requesting, highlight wrapping, bubble rendering
- `src/content/annotation.css` — highlight + icon styles (injected into page, `anno-` scoped)
- `src/side_panel/features/annotation.ts` — button wiring, state machine, progress + follow-up listeners
- `src/side_panel/features/annotation.css` — button styles
- `tests/background/sw-annotation.test.ts`
- `tests/content/annotation.test.ts`
- `tests/side_panel/features/annotation.test.ts`

**Modified files:**
- `src/background/service-worker.ts` — register `annotation` port
- `src/content/index.ts` — dispatch `startAnnotation` / `clearAnnotation` messages
- `src/side_panel/index.html` — add「深度批阅」button + CSS link
- `src/side_panel/main.ts` — call `initAnnotation()`
- `src/shared/i18n.js` — add `annotation.*` keys (zh + en)

**Build note (from spec §7.3):** `build-extension.js` and `scripts/watch-iife.js` bundle `src/content/index.ts` and `src/background/service-worker.ts` as IIFE entries — new modules are pulled in via `import`, no build config changes needed. Vite picks up side panel changes automatically.

**Convention note:** Per the existing codebase, every domain (`sw-tts`, `sw-podcast`, `sw-chart`, `sw-ocr`) owns its own fetch logic in its own `sw-*.ts`; `sw-openai.callOpenAI` is streaming-oriented (emits `chunk` events). Annotation needs a *complete* JSON object, so `sw-annotation.ts` does its own non-streaming fetch with `response_format: { type: 'json_object' }` — consistent with the "one domain = one sw module" pattern, and leaves `sw-openai.ts` untouched.

---

## Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts` (append after `PageRelation` interface, line ~78)

- [ ] **Step 1: Add the three annotation types**

Append to `src/shared/types.ts`:

```typescript
/**
 * Deep annotation (深度批阅) — AI-generated deep-perspective annotations
 * attached to sentences in the page. See
 * docs/superpowers/specs/2026-06-20-deep-annotation-design.md
 */

/** Three deep-perspective categories. */
export type AnnotationPerspective = 'critique' | 'counterpoint' | 'flaw';
//                         批判质疑       反方观点        逻辑漏洞

/** A single annotation on a quoted sentence. */
export interface Annotation {
  /** Generated client-side via crypto.randomUUID(). */
  id: string;
  perspective: AnnotationPerspective;
  /** Original-sentence quote returned by the model; used for DOM matching. */
  quote: string;
  /** Annotation body, 1-2 sentences. */
  comment: string;
}

/** Result of annotating one chunk. `annotations` may be empty (no worthy points). */
export interface AnnotationResult {
  chunkIndex: number;
  annotations: Annotation[];
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(annotation): add shared types for deep annotation feature"
```

---

## Task 2: Background handler — prompt assembly (pure function, TDD)

This task builds the testable, pure prompt-assembly + response-parsing layer in `sw-annotation.ts`, WITHOUT the fetch. The fetch is added in Task 3.

**Files:**
- Create: `src/background/sw-annotation.ts`
- Test: `tests/background/sw-annotation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/background/sw-annotation.test.ts`:

```typescript
import { vi, describe, it, expect } from 'vitest';
import { buildAnnotationMessages, parseAnnotationResponse, ANNOTATION_SYSTEM_PROMPT } from '../../src/background/sw-annotation.js';
import type { Annotation } from '../../src/shared/types';

describe('sw-annotation prompt assembly', () => {
  describe('ANNOTATION_SYSTEM_PROMPT', () => {
    it('defines the three perspectives', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('critique');
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('counterpoint');
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('flaw');
    });

    it('demands verbatim quotes', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toMatch(/原样|verbatim|真实存在/);
    });

    it('allows returning empty when nothing is worth annotating', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('宁缺毋滥');
    });
  });

  describe('buildAnnotationMessages', () => {
    it('returns system + user messages with full article and target chunk', () => {
      const messages = buildAnnotationMessages({
        fullArticle: 'FULL ARTICLE TEXT',
        chunkIndex: 3,
        chunkText: 'TARGET CHUNK TEXT',
      });

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'system', content: ANNOTATION_SYSTEM_PROMPT });

      const user = messages[1].content as string;
      expect(user).toContain('FULL ARTICLE TEXT');
      expect(user).toContain('TARGET CHUNK TEXT');
      expect(user).toContain('<full_article>');
      expect(user).toContain('<target_chunk>');
      expect(user).toContain('第 3 段');
    });
  });

  describe('parseAnnotationResponse', () => {
    it('parses a valid response into Annotation[]', () => {
      const raw = JSON.stringify({
        annotations: [
          { perspective: 'critique', quote: '性能提升 30%', comment: '基线是什么？' },
          { perspective: 'flaw', quote: '因此 A 导致 B', comment: '推理跳步。' },
        ],
      });

      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(2);
      expect(result[0].perspective).toBe('critique');
      expect(result[0].quote).toBe('性能提升 30%');
      expect(result[0].id).toMatch(/^[\da-f-]{36}$/i); // UUID shape
    });

    it('returns empty array when model reports no worthy points', () => {
      const result = parseAnnotationResponse(JSON.stringify({ annotations: [] }));
      expect(result).toEqual([]);
    });

    it('drops annotations with invalid perspective or missing fields', () => {
      const raw = JSON.stringify({
        annotations: [
          { perspective: 'critique', quote: 'good', comment: 'ok' },
          { perspective: 'bogus', quote: 'bad', comment: 'no' },        // invalid perspective
          { perspective: 'flaw', quote: '', comment: 'empty quote' },    // empty quote
          { perspective: 'flaw', quote: 'no comment' },                  // missing comment
        ],
      });
      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(1);
      expect(result[0].perspective).toBe('critique');
    });

    it('returns empty array on malformed JSON', () => {
      expect(parseAnnotationResponse('not json')).toEqual([]);
      expect(parseAnnotationResponse('')).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/background/sw-annotation.test.ts`
Expected: FAIL — module `../../src/background/sw-annotation.js` not found.

- [ ] **Step 3: Implement the pure functions**

Create `src/background/sw-annotation.ts`:

```typescript
import { safePostMessage } from './sw-utils';
import type { Annotation, AnnotationPerspective } from '../shared/types';

export const ANNOTATION_SYSTEM_PROMPT = `你是一位严谨、犀利但不刻薄的阅读批注员。你的任务是对用户提供的文章段落提供三类深度视角的批注，帮助读者看到字面之外的东西。

三类视角：
- critique（批判）：质疑数据来源、样本、基线、因果关系等。只批真正有问题的，不为了批而批。
- counterpoint（反方）：提出作者忽略或回避的对立观点、利益相关方视角。
- flaw（逻辑漏洞）：指出推理跳步、前后矛盾、偷换概念、循环论证。

要求：
1. 只批真正有价值的点——宁缺毋滥。没有值得批的句子就不要硬凑。
2. 每条批注的 quote 必须是段落中真实存在的连续句子（原样引用，不可改写或缩写）。
3. comment 控制在 1-2 句，锋利、具体、有信息量，不要空话套话。
4. 返回 JSON，不要任何额外文字。`;

interface BuildArgs {
  fullArticle: string;
  chunkIndex: number;
  chunkText: string;
}

/** Assemble system + user messages for one chunk annotation request. */
export function buildAnnotationMessages({ fullArticle, chunkIndex, chunkText }: BuildArgs): { role: 'system' | 'user'; content: string }[] {
  const userPrompt = `以下是完整文章作为上下文：

<full_article>
${fullArticle}
</full_article>

请只对【第 ${chunkIndex} 段】进行批注。该段内容：

<target_chunk>
${chunkText}
</target_chunk>

返回格式（JSON object）：
{
  "annotations": [
    {
      "perspective": "critique" | "counterpoint" | "flaw",
      "quote": "段落中原样引用的句子",
      "comment": "你的批注，1-2句"
    }
  ]
}

如果该段没有值得批注的点，返回 {"annotations": []}。`;

  return [
    { role: 'system', content: ANNOTATION_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

const VALID_PERSPECTIVES: ReadonlySet<AnnotationPerspective> = new Set(['critique', 'counterpoint', 'flaw']);

interface RawAnnotation {
  perspective?: unknown;
  quote?: unknown;
  comment?: unknown;
}

interface RawResponse {
  annotations?: unknown;
}

/**
 * Parse + validate the model's JSON response into well-formed Annotation[].
 * Assigns a client-side UUID. Drops malformed entries. Never throws.
 */
export function parseAnnotationResponse(raw: string): Annotation[] {
  let parsed: RawResponse;
  try {
    parsed = JSON.parse(raw) as RawResponse;
  } catch {
    return [];
  }

  const list = Array.isArray(parsed.annotations) ? (parsed.annotations as RawAnnotation[]) : [];
  const out: Annotation[] = [];
  for (const item of list) {
    const perspective = item.perspective;
    const quote = typeof item.quote === 'string' ? item.quote.trim() : '';
    const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
    if (typeof perspective !== 'string' || !VALID_PERSPECTIVES.has(perspective as AnnotationPerspective)) continue;
    if (!quote || !comment) continue;
    out.push({
      id: genId(),
      perspective: perspective as AnnotationPerspective,
      quote,
      comment,
    });
  }
  return out;
}

function genId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

// Re-exported for sw-annotation fetch layer (Task 3); harmless if unused in isolation tests.
export { safePostMessage };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/background/sw-annotation.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/background/sw-annotation.ts tests/background/sw-annotation.test.ts
git commit -m "feat(annotation): add background prompt assembly + response parsing"
```

---

## Task 3: Background handler — non-streaming JSON fetch over port

Add the fetch layer that the `annotation` port calls. Non-streaming because we need a complete JSON object.

**Files:**
- Modify: `src/background/sw-annotation.ts` (append `annotateChunk`)
- Test: `tests/background/sw-annotation.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Append to `tests/background/sw-annotation.test.ts` (keep existing imports; add a new describe block and a fetch mock). Add this inside the file after the existing imports, plus extend the top-level mock setup. First, add these mocks at the top of the file (after the existing imports):

```typescript
// --- Mock chrome.storage.sync (for annotateChunk config read) ---
const annotationStore: Record<string, unknown> = {
  apiKey: 'sk-test',
  apiBase: 'https://api.deepseek.com',
  modelName: 'deepseek-chat',
};
vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys: string[] | string) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((k) => {
          if (annotationStore[k] !== undefined) result[k] = annotationStore[k];
        });
        return Promise.resolve(result);
      },
    },
  },
});

// --- Mock sw-utils ---
vi.mock('../../src/background/sw-utils.js', () => ({
  safePostMessage: vi.fn(),
}));

// --- Mock global fetch ---
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { annotateChunk } from '../../src/background/sw-annotation.js';
import { safePostMessage } from '../../src/background/sw-utils.js';

function mockPort() {
  return {
    postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
  } as unknown as chrome.runtime.Port;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
```

Then append the new describe block at the end of the file:

```typescript
describe('sw-annotation annotateChunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts error when apiKey missing', async () => {
    annotationStore.apiKey = '';
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => (c[1] as Record<string, unknown>).type === 'error')).toBe(true);
    annotationStore.apiKey = 'sk-test';
  });

  it('posts annotated result with parsed annotations on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ annotations: [
          { perspective: 'critique', quote: 'q', comment: 'c' },
        ] }) } }],
      }),
    );
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 2, chunkText: 'C' }, port);

    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    const annotated = calls.find((c) => (c[1] as Record<string, unknown>).type === 'annotated');
    expect(annotated).toBeTruthy();
    const payload = annotated![1] as { chunkIndex: number; annotations: Annotation[] };
    expect(payload.chunkIndex).toBe(2);
    expect(payload.annotations).toHaveLength(1);
    expect(payload.annotations[0].perspective).toBe('critique');
  });

  it('posts error when response not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => (c[1] as Record<string, unknown>).type === 'error')).toBe(true);
  });

  it('posts empty annotations when model returns empty array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ annotations: [] }) } }] }),
    );
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    const calls = (safePostMessage as ReturnType<typeof vi.fn>).mock.calls;
    const annotated = calls.find((c) => (c[1] as Record<string, unknown>).type === 'annotated');
    expect((annotated![1] as { annotations: unknown[] }).annotations).toEqual([]);
  });

  it('aborts when port disconnects', async () => {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      // Simulate the abort listener firing
      const ctrl = init.signal as AbortSignal;
      // Trigger abort synchronously to mimic port.onDisconnect callback
      setTimeout(() => (ctrl as unknown as { aborted: boolean }).dispatchEvent?.(new Event('abort')), 0);
      return Promise.resolve({ ok: false, status: 0, json: async () => ({}) } as unknown as Response);
    });
    const port = mockPort();
    await annotateChunk({ fullArticle: 'A', chunkIndex: 0, chunkText: 'C' }, port);
    // port.onDisconnect.addListener was registered
    expect(port.onDisconnect.addListener).toHaveBeenCalled();
  });
});
```

Note: `describe`, `it`, `expect`, `beforeEach`, `vi` are already imported at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/background/sw-annotation.test.ts`
Expected: FAIL — `annotateChunk` is not exported.

- [ ] **Step 3: Implement annotateChunk**

Append to `src/background/sw-annotation.ts` (after `parseAnnotationResponse`, before the `genId` re-export line — keep `genId` and the `safePostMessage` re-export at the end):

```typescript
interface AnnotateArgs {
  fullArticle: string;
  chunkIndex: number;
  chunkText: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Annotate one chunk via a non-streaming OpenAI-compatible call with JSON mode.
 * Posts `{type:'annotated', chunkIndex, annotations}` or `{type:'error', error}` to the port.
 * Aborts the request if the port disconnects.
 */
export async function annotateChunk(args: AnnotateArgs, port: chrome.runtime.Port): Promise<void> {
  const { apiKey, apiBase, modelName } = (await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName'])) as {
    apiKey?: string; apiBase?: string; modelName?: string;
  };
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKey' }); return; }

  const baseUrl = apiBase || 'https://api.deepseek.com';
  const controller = new AbortController();
  const onDisconnect = () => controller.abort();
  port.onDisconnect.addListener(onDisconnect);

  try {
    const messages = buildAnnotationMessages(args);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelName || 'deepseek-chat',
        messages,
        stream: false,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = (errorData as Record<string, { message?: string }>)?.error?.message || `API request failed (${response.status})`;
      safePostMessage(port, { type: 'error', error: msg });
      return;
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const raw = data.choices?.[0]?.message?.content || '';
    const annotations = parseAnnotationResponse(raw);
    safePostMessage(port, { type: 'annotated', chunkIndex: args.chunkIndex, annotations });
  } catch (e: unknown) {
    safePostMessage(port, { type: 'error', error: (e as Error).message });
  } finally {
    port.onDisconnect.removeListener(onDisconnect);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/background/sw-annotation.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/background/sw-annotation.ts tests/background/sw-annotation.test.ts
git commit -m "feat(annotation): add non-streaming annotateChunk fetch over port"
```

---

## Task 4: Register the annotation port in service-worker

**Files:**
- Modify: `src/background/service-worker.ts` (in the `onConnect` listener, around line 35-39, after the `embedding` branch)

- [ ] **Step 1: Add the import**

In `src/background/service-worker.ts`, add to the imports at the top (after the `handleOcrParse` import, line 5):

```typescript
import { annotateChunk } from './sw-annotation';
```

- [ ] **Step 2: Register the port handler**

Inside the `chrome.runtime.onConnect.addListener` block, after the `embedding` `else if` branch (after line 39), add:

```typescript
  } else if (port.name === 'annotation') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'annotate') {
        await annotateChunk(
          {
            fullArticle: msg.fullArticle as string,
            chunkIndex: msg.chunkIndex as number,
            chunkText: msg.chunkText as string,
          },
          port,
        );
      }
    });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full background test suite (regression)**

Run: `npx vitest run tests/background/`
Expected: all pre-existing background tests still pass (no regressions in `service-worker.test.ts`, etc.).

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat(annotation): register annotation port in service worker"
```

---

## Task 5: Content module — chunk collection (pure, TDD)

Content-side logic is the heart of the feature. We build it in testable pure functions first: chunk collection, then highlight wrapping, then bubble rendering.

**Files:**
- Create: `src/content/annotation.ts`
- Test: `tests/content/annotation.test.ts`

- [ ] **Step 1: Write the failing test for chunk collection**

Create `tests/content/annotation.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement collectChunks + CollectedChunk type**

Create `src/content/annotation.ts`:

```typescript
/**
 * Deep annotation content module — collects paragraph chunks from the page,
 * requests per-chunk annotations via the background 'annotation' port,
 * highlights model-quoted sentences, and renders click-to-open bubbles.
 *
 * Spec: docs/superpowers/specs/2026-06-20-deep-annotation-design.md
 */
import type { Annotation, AnnotationPerspective } from '../shared/types';

/** Minimum paragraph length (trimmed) to be considered a content chunk. */
export const MIN_CHUNK_LENGTH = 40;

export interface CollectedChunk {
  node: HTMLParagraphElement;
  text: string;
}

/** Selectors for semantic content containers, in priority order. */
const CONTAINER_SELECTORS = ['article', 'main', '[role="main"]'];

/**
 * Collect content paragraphs from the page as ordered chunks.
 * Prefers article/main/[role=main] containers; falls back to body <p>.
 * Skips non-content elements (nav, footer, script, aside, etc.) and short paragraphs.
 */
export function collectChunks(root: Document | HTMLElement = document): CollectedChunk[] {
  const doc = root;
  let container: ParentNode | null = null;
  for (const sel of CONTAINER_SELECTORS) {
    const found = (doc as Document).querySelector?.(sel) ?? null;
    if (found) { container = found; break; }
  }
  if (!container) container = (doc as Document).body ?? null;
  if (!container) return [];

  const paragraphs = Array.from(container.querySelectorAll<HTMLParagraphElement>('p'));
  const chunks: CollectedChunk[] = [];
  for (const p of paragraphs) {
    // Skip paragraphs inside nav/footer/script/aside
    if (p.closest('nav, footer, aside, script, style')) continue;
    const text = (p.innerText || p.textContent || '').trim();
    if (text.length < MIN_CHUNK_LENGTH) continue;
    chunks.push({ node: p, text });
  }
  return chunks;
}

/** Build the full-article context string from collected chunks. */
export function buildFullArticle(chunks: CollectedChunk[]): string {
  return chunks.map((c, i) => `[第${i}段] ${c.text}`).join('\n\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/annotation.ts tests/content/annotation.test.ts
git commit -m "feat(annotation): add content chunk collection"
```

---

## Task 6: Content module — highlight wrapping (pure DOM function, TDD)

`findAndWrap` locates a verbatim quote inside a paragraph's text nodes and wraps it in `<mark class="anno-mark">`. Returns `true` if found. This is the algorithmic core; tested thoroughly.

**Files:**
- Modify: `src/content/annotation.ts` (append)
- Test: `tests/content/annotation.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Append to `tests/content/annotation.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: FAIL — `findAndWrap` not exported.

- [ ] **Step 3: Implement findAndWrap**

Append to `src/content/annotation.ts`:

```typescript
/** CSS class applied to highlighted quote spans. */
export const MARK_CLASS = 'anno-mark';

/**
 * Locate `quote` inside the text-node tree of `root` and wrap the first
 * occurrence in <mark class="anno-mark">. Handles quotes that span multiple
 * adjacent text nodes. Leading/trailing whitespace on the quote is ignored.
 *
 * Returns true if the quote was found and wrapped; false otherwise (root left
 * unmodified).
 */
export function findAndWrap(root: HTMLElement, quote: string): boolean {
  const q = quote.trim();
  if (!q) return false;

  // Gather text nodes with their cumulative offset.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const entries: { node: Text; start: number; length: number }[] = [];
  let offset = 0;
  let current: Text | null;
  while ((current = walker.nextNode() as Text | null)) {
    if (current.nodeValue) {
      entries.push({ node: current, start: offset, length: current.nodeValue.length });
      offset += current.nodeValue.length;
    }
  }
  if (entries.length === 0) return false;

  const full = entries.map((e) => e.node.nodeValue!).join('');
  const at = full.indexOf(q);
  if (at === -1) return false;
  const end = at + q.length;

  // Split text nodes at the quote boundaries.
  const startNode = locateTextNode(entries, at);
  const endNode = locateTextNode(entries, end);

  // Walk forward from startNode to endNode, wrapping whole text nodes that fall
  // fully inside [at, end); split the boundary nodes.
  const mark = document.createElement('mark');
  mark.className = MARK_CLASS;

  // Build a range covering the quote and surround it. Range.surroundContents
  // requires the range to not partially select a non-text node — since our
  // range only touches text nodes, this is safe.
  const range = document.createRange();
  range.setStart(startNode.textNode, startNode.localOffset);
  range.setEnd(endNode.textNode, endNode.localOffset);

  try {
    range.surroundContents(mark);
    return true;
  } catch {
    // surroundContents can throw if the quote crosses element boundaries.
    // Fall back to manual wrapping across the collected text nodes.
    return manualWrap(entries, at, end);
  }
}

function locateTextNode(
  entries: { node: Text; start: number; length: number }[],
  globalOffset: number,
): { textNode: Text; localOffset: number } {
  for (const e of entries) {
    if (globalOffset >= e.start && globalOffset <= e.start + e.length) {
      return { textNode: e.node, localOffset: globalOffset - e.start };
    }
  }
  const last = entries[entries.length - 1];
  return { textNode: last.node, localOffset: last.length };
}

/** Fallback wrapper for quotes crossing element boundaries. */
function manualWrap(
  entries: { node: Text; start: number; length: number }[],
  at: number,
  end: number,
): boolean {
  let wrapped = false;
  for (const e of entries) {
    const nodeEnd = e.start + e.length;
    if (nodeEnd <= at || e.start >= end) continue; // no overlap
    const localStart = Math.max(0, at - e.start);
    const localEnd = Math.min(e.length, end - e.start);
    if (localStart >= localEnd) continue;
    const mark = document.createElement('mark');
    mark.className = MARK_CLASS;
    const middle = e.node.splitText(localStart);
    middle.splitText(localEnd - localStart);
    middle.parentNode!.insertBefore(mark, middle);
    mark.appendChild(middle);
    wrapped = true;
  }
  return wrapped;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: PASS — all collectChunks + findAndWrap tests green.

- [ ] **Step 5: Commit**

```bash
git add src/content/annotation.ts tests/content/annotation.test.ts
git commit -m "feat(annotation): add quote highlight wrapping in content module"
```

---

## Task 7: Content module — bubble rendering (Shadow DOM, TDD)

Render an isolated, click-to-open bubble as a custom element with a Shadow DOM. Tested via jsdom: attaching an icon, clicking it, and asserting the bubble opens/closes.

**Files:**
- Modify: `src/content/annotation.ts` (append)
- Test: `tests/content/annotation.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Append to `tests/content/annotation.test.ts`:

```typescript
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
    const bubble = host.querySelector('.anno-bubble') as HTMLElement | null;
    expect(bubble).toBeTruthy();
    expect(bubble!.querySelector('.anno-comment')!.textContent).toContain('A logic flaw comment');

    // click elsewhere closes it
    document.body.click();
    expect(host.querySelector('.anno-bubble')).toBeNull();
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
    const host = getBubbleHost();
    expect(host.querySelectorAll('.anno-bubble')).toHaveLength(1);

    h2.button.click();
    expect(host.querySelectorAll('.anno-bubble')).toHaveLength(1);
    expect(host.querySelector('.anno-comment')!.textContent).toContain('c2');
  });

  it('invokes the follow-up callback when the follow-up button is clicked', () => {
    const onFollowUp = vi.fn();
    const p = document.createElement('p');
    p.textContent = 'Some content paragraph that is long enough to be a chunk here.';
    document.body.appendChild(p);

    createIconFor(p, { id: 'a1', perspective: 'flaw', quote: 'Some', comment: 'comment body' }, onFollowUp);
    const icon = p.parentElement!.querySelector<HTMLButtonElement>('.anno-icon')!;
    icon.click();

    const host = getBubbleHost();
    const followBtn = host.querySelector<HTMLButtonElement>('.anno-followup')!;
    followBtn.click();
    expect(onFollowUp).toHaveBeenCalledWith('comment body');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: FAIL — `createIconFor` / `getBubbleHost` not exported.

- [ ] **Step 3: Implement bubble rendering**

Append to `src/content/annotation.ts`:

```typescript
import { ICON_BY_PERSPECTIVE, LABEL_BY_PERSPECTIVE } from './annotation-meta';

/** Singleton container appended to document.body; holds bubbles + isolated CSS. */
let _bubbleHost: HTMLElement | null = null;

/**
 * Return (and lazily create) the bubble host element whose Shadow DOM holds the
 * open bubble. Pass `reset=true` to drop the singleton (tests).
 */
export function getBubbleHost(reset = false): HTMLElement {
  if (reset) {
    _bubbleHost?.remove();
    _bubbleHost = null;
  }
  if (_bubbleHost) return _bubbleHost;

  const host = document.createElement('div');
  host.id = 'anno-bubble-host';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.top = '0';
  host.style.left = '0';
  host.style.pointerEvents = 'none';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${BUBBLE_CSS}</style><div class="anno-bubble-layer" part="layer"></div>`;
  document.body.appendChild(host);
  _bubbleHost = host;
  return host;
}

const BUBBLE_CSS = `
  .anno-bubble {
    pointer-events: auto;
    position: absolute;
    max-width: 320px;
    background: #fff;
    color: #1f2329;
    border: 1px solid #e5e6eb;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.14);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }
  .anno-bubble-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #f0f1f3; font-weight: 600; }
  .anno-bubble-label { flex: 1; }
  .anno-bubble-close { background: none; border: none; cursor: pointer; font-size: 14px; color: #86909c; padding: 0 2px; }
  .anno-comment { padding: 10px 12px; color: #1f2329; }
  .anno-followup { display: block; width: 100%; text-align: left; border: none; border-top: 1px solid #f0f1f3; background: #f7f8fa; color: #165dff; cursor: pointer; padding: 8px 12px; font: inherit; }
  .anno-followup:hover { background: #eef2ff; }
  .anno-bubble.critique .anno-bubble-header { background: #fff7e6; }
  .anno-bubble.counterpoint .anno-bubble-header { background: #e8f7ef; }
  .anno-bubble.flaw .anno-bubble-header { background: #fff1f0; }
`;

/** Handle returned when attaching an icon to a node. */
export interface IconHandle {
  button: HTMLButtonElement;
}

/**
 * Attach an annotation icon next to `node`. On click, opens a Shadow-DOM bubble
 * showing the comment; only one bubble open at a time. `onFollowUp` (optional)
 * is invoked with the comment text when the user clicks "follow up in chat".
 */
export function createIconFor(
  node: HTMLElement,
  annotation: Annotation,
  onFollowUp?: (comment: string) => void,
): IconHandle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `anno-icon anno-icon-${annotation.perspective}`;
  button.setAttribute('aria-label', LABEL_BY_PERSPECTIVE[annotation.perspective]);
  button.textContent = ICON_BY_PERSPECTIVE[annotation.perspective];
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    openBubble(button, annotation, onFollowUp);
  });
  // Place the icon immediately after the annotated node.
  node.insertAdjacentElement('afterend', button);
  return { button };
}

function openBubble(anchor: HTMLElement, annotation: Annotation, onFollowUp?: (comment: string) => void): void {
  const host = getBubbleHost();
  const layer = host.shadowRoot!.querySelector('.anno-bubble-layer')!;
  // Close any existing bubble (only one at a time).
  layer.innerHTML = '';

  const bubble = document.createElement('div');
  bubble.className = `anno-bubble ${annotation.perspective}`;
  bubble.innerHTML = `
    <div class="anno-bubble-header">
      <span>${ICON_BY_PERSPECTIVE[annotation.perspective]}</span>
      <span class="anno-bubble-label">${LABEL_BY_PERSPECTIVE[annotation.perspective]}</span>
      <button class="anno-bubble-close" type="button" aria-label="close">✕</button>
    </div>
    <div class="anno-comment"></div>
    <button class="anno-followup" type="button">↩ 在对话中追问</button>
  `;
  // Set comment text safely (avoid HTML injection).
  (bubble.querySelector('.anno-comment') as HTMLElement).textContent = annotation.comment;

  // Position roughly below the anchor.
  const rect = anchor.getBoundingClientRect();
  bubble.style.left = `${Math.max(8, rect.left)}px`;
  bubble.style.top = `${rect.bottom + 6}px`;
  layer.appendChild(bubble);

  const close = () => { layer.innerHTML = ''; document.removeEventListener('click', onDocClick); };
  const onDocClick = (ev: MouseEvent) => {
    const target = ev.target as Node;
    if (bubble.contains(target) || anchor.contains(target)) return;
    close();
  };
  (bubble.querySelector('.anno-bubble-close') as HTMLElement).addEventListener('click', close);
  (bubble.querySelector('.anno-followup') as HTMLElement).addEventListener('click', () => {
    onFollowUp?.(annotation.comment);
    close();
  });
  // Defer adding the outside-click listener so the current click doesn't close it immediately.
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
}
```

- [ ] **Step 4: Create the meta module (icon/label maps)**

Create `src/content/annotation-meta.ts`:

```typescript
import type { AnnotationPerspective } from '../shared/types';

export const ICON_BY_PERSPECTIVE: Record<AnnotationPerspective, string> = {
  critique: '🤨',
  counterpoint: '⚖️',
  flaw: '🔍',
};

export const LABEL_BY_PERSPECTIVE: Record<AnnotationPerspective, string> = {
  critique: '批判',
  counterpoint: '反方',
  flaw: '漏洞',
};
```

Update the import at the top of `src/content/annotation.ts` — replace the existing `import type { Annotation, AnnotationPerspective }` ... line is fine; ensure `annotation-meta` is imported. The Task 7 step 3 code already includes `import { ICON_BY_PERSPECTIVE, LABEL_BY_PERSPECTIVE } from './annotation-meta';` at the top of the appended block. Move it to the file's import section if the linter prefers (it works either way in esbuild).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: PASS — all content tests green.

- [ ] **Step 6: Commit**

```bash
git add src/content/annotation.ts src/content/annotation-meta.ts tests/content/annotation.test.ts
git commit -m "feat(annotation): add Shadow DOM bubble rendering in content module"
```

---

## Task 8: Content module — orchestration (start/clear annotation flow)

Wire chunk collection → background requests → highlight + icon insertion, plus progress reporting to the side panel. This is the `handleStartAnnotation` / `handleClearAnnotation` entry points called by `content/index.ts`.

**Files:**
- Modify: `src/content/annotation.ts` (append)
- Test: `tests/content/annotation.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Append to `tests/content/annotation.test.ts`:

```typescript
import { handleStartAnnotation, handleClearAnnotation, resetAnnotationState } from '../../src/content/annotation.js';

// --- chrome runtime mock for content orchestration ---
let postedRuntime: { action: string; [k: string]: unknown }[] = [];
const portListeners: ((msg: Record<string, unknown>) => void)[] = [];
function makePort() {
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: (cb: (m: Record<string, unknown>) => void) => portListeners.push(cb) },
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
    await handleStartAnnotation();
    await flushPorts(0, [{ id: 'a1', perspective: 'flaw', quote: 'First paragraph', comment: 'c' }]);
    // allow microtasks
    await new Promise((r) => setTimeout(r, 0));

    const p = document.querySelector('p')!;
    expect(p.querySelector('mark.anno-mark')).toBeTruthy();
    expect(document.querySelector('.anno-icon')).toBeTruthy();
  });

  it('degrades gracefully when quote not found (no mark, but still no crash)', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    await handleStartAnnotation();
    await flushPorts(0, [{ id: 'a1', perspective: 'critique', quote: 'a quote that does not exist', comment: 'c' }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('mark.anno-mark')).toBeNull();
  });

  it('clears all annotations on handleClearAnnotation', async () => {
    document.body.innerHTML = `<article><p>First paragraph with enough text to qualify as a content chunk one.</p></article>`;
    await handleStartAnnotation();
    await flushPorts(0, [{ id: 'a1', perspective: 'flaw', quote: 'First paragraph', comment: 'c' }]);
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: FAIL — `handleStartAnnotation` not exported.

- [ ] **Step 3: Implement orchestration**

Append to `src/content/annotation.ts`:

```typescript
/** Active annotation state, reset between runs. */
let _running = false;

export function resetAnnotationState(): void {
  _running = false;
}

/** Report an event back to the side panel via runtime messaging. */
function reportToPanel(msg: { action: string; [k: string]: unknown }): void {
  try { chrome.runtime.sendMessage(msg); } catch { /* context invalidated */ }
}

/**
 * Begin annotating the page: collect chunks, request annotations per chunk
 * (serially), highlight + insert icons progressively, and report progress.
 * Reports annotationProgress / annotationDone / annotationFailed to the panel.
 */
export async function handleStartAnnotation(): Promise<void> {
  if (_running) return;
  _running = true;

  const chunks = collectChunks(document);
  const fullArticle = buildFullArticle(chunks);
  reportToPanel({ action: 'annotationProgress', done: 0, total: chunks.length });

  let produced = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (!_running) break;
    const result = await requestChunk(fullArticle, i, chunks[i].text);
    if (result === 'failed') {
      reportToPanel({ action: 'annotationFailed', chunkIndex: i });
    } else if (result && result.length > 0) {
      for (const ann of result) {
        const wrapped = findAndWrap(chunks[i].node, ann.quote);
        // Even if the quote didn't match, attach the icon to the paragraph so the
        // annotation is still reachable (degraded, per spec §6.1).
        createIconFor(chunks[i].node, ann, (comment) =>
          reportToPanel({ action: 'annotationFollowUp', text: comment }),
        );
        produced += 1;
        void wrapped; // wrapped used only for its side effect
      }
    }
    reportToPanel({ action: 'annotationProgress', done: i + 1, total: chunks.length });
  }

  reportToPanel({ action: 'annotationDone', count: produced });
  _running = false;
}

/**
 * Request annotations for one chunk via the background 'annotation' port.
 * Returns the parsed Annotation[] on success, or 'failed' on error/disconnect.
 */
function requestChunk(fullArticle: string, chunkIndex: number, chunkText: string): Promise<Annotation[] | 'failed'> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'annotation' });
    const cleanup = () => { port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect); };
    const onMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'annotated') {
        cleanup();
        port.disconnect();
        resolve((msg.annotations as Annotation[]) || []);
      } else if (msg.type === 'error') {
        cleanup();
        port.disconnect();
        resolve('failed');
      }
    };
    const onDisconnect = () => { cleanup(); resolve('failed'); };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage({ type: 'annotate', fullArticle, chunkIndex, chunkText });
  });
}

/** Remove every annotation artifact from the page (marks, icons, bubbles). */
export function handleClearAnnotation(): void {
  _running = false;
  // Unwrap marks: replace each <mark.anno-mark> with its children.
  document.querySelectorAll('mark.anno-mark').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
  document.querySelectorAll('.anno-icon').forEach((icon) => icon.remove());
  const host = getBubbleHost();
  const layer = host.shadowRoot?.querySelector('.anno-bubble-layer');
  if (layer) layer.innerHTML = '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/content/annotation.test.ts`
Expected: PASS — all content tests green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/content/annotation.ts tests/content/annotation.test.ts
git commit -m "feat(annotation): add content orchestration (start/clear flow)"
```

---

## Task 9: Content script — page-injected CSS + message dispatch

Inject highlight/icon styles into the page, and wire `startAnnotation` / `clearAnnotation` messages from the side panel.

**Files:**
- Create: `src/content/annotation.css`
- Modify: `src/content/annotation.ts` (add CSS injection call)
- Modify: `src/content/index.ts` (message dispatch)

- [ ] **Step 1: Create the page-injected CSS**

Create `src/content/annotation.css`:

```css
.anno-mark {
  background: #fff3bf;
  border-radius: 2px;
  padding: 0 1px;
  box-shadow: inset 0 -2px 0 rgba(255, 193, 7, 0.5);
}
.anno-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: 0 2px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  vertical-align: middle;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.anno-icon:hover { transform: scale(1.12); }
.anno-icon-critique { background: #fff7e6; }
.anno-icon-counterpoint { background: #e8f7ef; }
.anno-icon-flaw { background: #fff1f0; }
```

- [ ] **Step 2: Add CSS injection to the content module**

Append to `src/content/annotation.ts`:

```typescript
/** Page-injected highlight/icon styles. Kept as a string so the IIFE bundle
 *  includes them without a separate fetch. Mirrors src/content/annotation.css. */
export const ANNOTATION_CSS = `
.anno-mark { background: #fff3bf; border-radius: 2px; padding: 0 1px; box-shadow: inset 0 -2px 0 rgba(255,193,7,0.5); }
.anno-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin: 0 2px; border: 1px solid rgba(0,0,0,0.12); border-radius: 50%; background: #fff; cursor: pointer; font-size: 12px; line-height: 1; vertical-align: middle; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.anno-icon:hover { transform: scale(1.12); }
.anno-icon-critique { background: #fff7e6; }
.anno-icon-counterpoint { background: #e8f7ef; }
.anno-icon-flaw { background: #fff1f0; }
`;

let _cssInjected = false;

/** Inject the highlight/icon stylesheet into the page head once. */
export function injectAnnotationCSS(): void {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'anno-styles';
  style.textContent = ANNOTATION_CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}
```

- [ ] **Step 3: Wire message dispatch in content/index.ts**

In `src/content/index.ts`, add the import after the existing imports (line 2):

```typescript
import { handleStartAnnotation, handleClearAnnotation, injectAnnotationCSS } from './annotation';
```

Then extend the existing `handlers` object in `chrome.runtime.onMessage.addListener` (currently lines 5-9). Replace the listener body's handler map so it becomes:

```typescript
chrome.runtime.onMessage.addListener((request: { action?: string }, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  const handlers: Record<string, (msg: unknown, sendResponse: (r?: unknown) => void) => true | void> = {
    extract: handleExtract,
    detectCharts: handleDetectCharts,
    captureChart: handleCaptureChart as (msg: unknown, sendResponse: (r?: unknown) => void) => true,
  };
  const handler = handlers[request.action || ''];
  if (handler) return handler(request, sendResponse);

  // Annotation actions are fire-and-forget (no response payload needed).
  if (request.action === 'startAnnotation') {
    injectAnnotationCSS();
    handleStartAnnotation();
    sendResponse({ ok: true });
    return;
  }
  if (request.action === 'clearAnnotation') {
    handleClearAnnotation();
    sendResponse({ ok: true });
    return;
  }
});
```

- [ ] **Step 4: Type-check + run content tests (regression)**

Run: `npx tsc --noEmit`
Run: `npx vitest run tests/content/`
Expected: no type errors; content tests pass (including the pre-existing `page-extractor.test.js`).

- [ ] **Step 5: Commit**

```bash
git add src/content/annotation.css src/content/annotation.ts src/content/index.ts
git commit -m "feat(annotation): inject page CSS + dispatch annotation messages in content script"
```

---

## Task 10: Side panel feature — button + state machine (TDD)

The side panel feature owns the「深度批阅」button, its state machine (idle → annotating → done → idle), and listens for progress/done/failed/followUp messages from content.

**Files:**
- Create: `src/side_panel/features/annotation.ts`
- Test: `tests/side_panel/features/annotation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/side_panel/features/annotation.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

// chrome mock
let runtimeListeners: ((msg: Record<string, unknown>) => void)[] = [];
const tabsQuery = vi.fn();
const tabsSendMessage = vi.fn();
vi.stubGlobal('chrome', {
  tabs: { query: tabsQuery, sendMessage: tabsSendMessage },
  runtime: {
    onMessage: { addListener: (cb: (m: Record<string, unknown>) => void) => runtimeListeners.push(cb) },
  },
});

import { initAnnotation, __setButtonForTest, __getAnnotationState } from '../../../src/side_panel/features/annotation.js';

function fireRuntime(msg: Record<string, unknown>): void {
  for (const cb of runtimeListeners) cb(msg);
}

describe('side_panel/features/annotation', () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="annotationBtn" class="action-btn"><span class="action-icon">🩺</span><span data-i18n="annotation.button">深度批阅</span></button>`;
    runtimeListeners = [];
    tabsQuery.mockClear();
    tabsSendMessage.mockClear();
    tabsQuery.mockResolvedValue([{ id: 42 }]);
  });

  it('sends startAnnotation to the active tab on button click', async () => {
    initAnnotation({ button: document.getElementById('annotationBtn') as HTMLButtonElement });
    document.getElementById('annotationBtn')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(tabsSendMessage).toHaveBeenCalledWith(42, { action: 'startAnnotation' }, expect.any(Function));
  });

  it('updates button label to progress on annotationProgress', () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationProgress', done: 3, total: 8 });
    expect(btn.textContent).toContain('3');
    expect(btn.textContent).toContain('8');
    expect(__getAnnotationState()).toBe('annotating');
  });

  it('updates button label and state on annotationDone', () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationDone', count: 12 });
    expect(btn.textContent).toContain('12');
    expect(__getAnnotationState()).toBe('done');
  });

  it('clears annotations (clearAnnotation) on a second click when done', async () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationDone', count: 5 });
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tabsSendMessage).toHaveBeenCalledWith(42, { action: 'clearAnnotation' }, expect.any(Function));
    expect(__getAnnotationState()).toBe('idle');
  });

  it('disables the button and shows error state on annotationFailed', () => {
    const btn = document.getElementById('annotationBtn') as HTMLButtonElement;
    initAnnotation({ button: btn });
    fireRuntime({ action: 'annotationProgress', done: 0, total: 4 });
    fireRuntime({ action: 'annotationFailed', chunkIndex: 0 });
    expect(__getAnnotationState()).toBe('error');
  });

  it('fills the input with the comment on annotationFollowUp', () => {
    const input = document.createElement('textarea');
    input.id = 'userInput';
    document.body.appendChild(input);
    initAnnotation({
      button: document.getElementById('annotationBtn') as HTMLButtonElement,
      userInput: input,
    });
    fireRuntime({ action: 'annotationFollowUp', text: 'follow up on this' });
    expect(input.value).toContain('follow up on this');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/side_panel/features/annotation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the feature**

Create `src/side_panel/features/annotation.ts`:

```typescript
/**
 * Deep annotation side-panel feature — owns the「深度批阅」button, its state
 * machine, and relays messages to/from the content module.
 *
 * State machine: idle → annotating → done → (click) → idle
 *                                   ↘ error
 *
 * Messages from content (via chrome.runtime.onMessage):
 *   annotationProgress {done, total} — update button label
 *   annotationDone {count}           — mark done, show count
 *   annotationFailed {chunkIndex}    — mark error
 *   annotationFollowUp {text}        — fill input for follow-up chat
 */
import { t } from '../../shared/i18n.js';

type AnnotationState = 'idle' | 'annotating' | 'done' | 'error';

let _button: HTMLButtonElement | null = null;
let _userInput: HTMLTextAreaElement | null = null;
let _state: AnnotationState = 'idle';

export interface AnnotationDeps {
  button: HTMLButtonElement;
  userInput?: HTMLTextAreaElement;
}

export function initAnnotation(deps: AnnotationDeps): void {
  _button = deps.button;
  _userInput = deps.userInput ?? null;

  _button.addEventListener('click', onButtonClick);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  renderButton();
}

async function onButtonClick(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId == null) return;

  if (_state === 'done' || _state === 'error') {
    // Second click clears annotations and returns to idle.
    chrome.tabs.sendMessage(tabId, { action: 'clearAnnotation' }, () => undefined);
    setState('idle');
    return;
  }
  if (_state === 'idle') {
    chrome.tabs.sendMessage(tabId, { action: 'startAnnotation' }, () => undefined);
    setState('annotating');
  }
}

function onRuntimeMessage(msg: Record<string, unknown>): void {
  const action = msg.action as string;
  if (action === 'annotationProgress') {
    setState('annotating');
    _button!.innerHTML = `<span class="action-icon">⏳</span><span>${t('annotation.buttonActive', { done: msg.done, total: msg.total })}</span>`;
  } else if (action === 'annotationDone') {
    setState('done');
    _button!.innerHTML = `<span class="action-icon">✓</span><span>${t('annotation.buttonDone', { n: msg.count })}</span>`;
  } else if (action === 'annotationFailed') {
    setState('error');
    _button!.innerHTML = `<span class="action-icon">⚠️</span><span>${t('annotation.error')}</span>`;
  } else if (action === 'annotationFollowUp') {
    const text = (msg.text as string) || '';
    if (_userInput) _userInput.value = _userInput.value ? `${_userInput.value}\n${text}` : text;
  }
}

function setState(next: AnnotationState): void {
  _state = next;
  renderButton();
}

function renderButton(): void {
  if (!_button) return;
  if (_state === 'idle') {
    _button.innerHTML = `<span class="action-icon">🩺</span><span>${t('annotation.button')}</span>`;
  }
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

// --- Test accessors (only used by unit tests) ---
export function __setButtonForTest(btn: HTMLButtonElement): void { _button = btn; }
export function __getAnnotationState(): AnnotationState { return _state; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/side_panel/features/annotation.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/features/annotation.ts tests/side_panel/features/annotation.test.ts
git commit -m "feat(annotation): add side panel feature with button state machine"
```

---

## Task 11: i18n keys

**Files:**
- Modify: `src/shared/i18n.js` (add keys to both `zh` and `en` blocks)

- [ ] **Step 1: Add Chinese keys**

In `src/shared/i18n.js`, inside the `zh: { ... }` block, right after the `'related.*'` keys (after line 251, `'related.weeksAgo'`), add:

```javascript
    'annotation.button': '深度批阅',
    'annotation.buttonActive': '批阅中...（{done}/{total}）',
    'annotation.buttonDone': '✓ 批阅完成（{n} 处）',
    'annotation.error': '批阅失败，点击重试',
    'annotation.critique': '批判',
    'annotation.counterpoint': '反方',
    'annotation.flaw': '漏洞',
    'annotation.followUp': '在对话中追问',
    'annotation.close': '关闭',
```

- [ ] **Step 2: Add English keys**

In the `en: { ... }` block, right after the English `'related.*'` keys (after line 503, `'related.weeksAgo'`), add:

```javascript
    'annotation.button': 'Deep Annotate',
    'annotation.buttonActive': 'Annotating... ({done}/{total})',
    'annotation.buttonDone': '✓ Done ({n} annotations)',
    'annotation.error': 'Failed, click to retry',
    'annotation.critique': 'Critique',
    'annotation.counterpoint': 'Counterpoint',
    'annotation.flaw': 'Flaw',
    'annotation.followUp': 'Follow up in chat',
    'annotation.close': 'Close',
```

- [ ] **Step 3: Run i18n tests (regression)**

Run: `npx vitest run tests/shared/`
Expected: existing i18n tests pass; no key collisions.

- [ ] **Step 4: Commit**

```bash
git add src/shared/i18n.js
git commit -m "feat(annotation): add annotation i18n keys (zh + en)"
```

---

## Task 12: Wire button into HTML + main.ts

**Files:**
- Modify: `src/side_panel/index.html` (add button + CSS link)
- Create: `src/side_panel/features/annotation.css`
- Modify: `src/side_panel/main.ts` (call initAnnotation)

- [ ] **Step 1: Create the button CSS**

Create `src/side_panel/features/annotation.css`:

```css
/* 深度批阅 button reuses .action-btn styling; this file exists for future
   annotation-specific panel styles. Intentionally minimal for v1. */
.action-btn[data-action="annotation"] {
  position: relative;
}
```

- [ ] **Step 2: Add the button + CSS link to index.html**

In `src/side_panel/index.html`, add the stylesheet link in `<head>` after the `related-pages.css` link (after line 15):

```html
  <link rel="stylesheet" href="features/annotation.css">
```

Then in the quick-actions block, add a new button after the podcast button (after line 99, before the closing `</div>` of `.quick-actions`):

```html
      <button class="action-btn" data-action="annotation">
        <span class="action-icon">🩺</span>
        <span data-i18n="annotation.button">深度批阅</span>
      </button>
```

- [ ] **Step 3: Wire initAnnotation in main.ts**

In `src/side_panel/main.ts`, add the import after the `initRelatedPages` import (line 17):

```typescript
import { initAnnotation } from './features/annotation';
```

Then in the `init()` function, after `initRelatedPages({ chatArea: els.chatArea });` (line 70), add:

```typescript
  const annotationBtn = document.querySelector<HTMLButtonElement>('[data-action="annotation"]');
  if (annotationBtn) {
    initAnnotation({ button: annotationBtn, userInput: els.userInput });
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/side_panel/features/annotation.css src/side_panel/index.html src/side_panel/main.ts
git commit -m "feat(annotation): wire 深度批阅 button into side panel UI"
```

---

## Task 13: Full build + test verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass. New test files added: `tests/background/sw-annotation.test.ts`, `tests/content/annotation.test.ts`, `tests/side_panel/features/annotation.test.ts`. Total test count should increase by ~30+ from the 444 baseline.

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors in new files. Fix any lint issues that surface.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: build succeeds. `dist/content.js` and `dist/background.js` (IIFE) and `dist/assets/*` (side panel) all written. The annotation modules are bundled into the IIFE outputs.

- [ ] **Step 5: Smoke-check the bundle contains annotation code**

Run: `grep -c "anno-mark" dist/content.js && grep -c "annotation" dist/background.js`
Expected: both return a positive integer (the annotation CSS and port handler are present in the bundles).

- [ ] **Step 6: Manual smoke test (load extension)**

Load `dist/` in `chrome://extensions/`. On any article page, open the side panel, click「深度批阅」, and verify:
- Button label changes to "批阅中...（k/N）" then "✓ 批阅完成（N 处）"
- Some sentences get a yellow highlight with an icon (🤨/⚖️/🔍)
- Clicking an icon opens a bubble with the comment
- Clicking elsewhere closes the bubble
- Clicking "↩ 在对话中追问" fills the input box
- Clicking the button again (in done state) clears all annotations

- [ ] **Step 7: Commit if any fixes were needed, then done**

```bash
# Only if Step 6 surfaced fixes:
git add -A
git commit -m "fix(annotation): smoke-test fixes"
```

---

## Self-Review Notes

**Spec coverage check (spec §1–§10):**
- §2 decisions (form/perspectives/trigger/architecture/chunking/format/bubble/isolation/followup/re-click/lang) → Tasks 1–12 ✓
- §3 data flow & module responsibilities → Tasks 2,3 (bg), 5–9 (content), 10 (panel) ✓
- §4 prompt + data contract → Task 1 (types), Task 2 (prompt) ✓
- §5 bubble UI/interaction → Task 7 (rendering), Task 10 (button state machine) ✓
- §5.5 state machine (idle/annotating/done/error) → Task 10 ✓
- §6.1 quote-match-failure degradation → Task 8 (icon attaches even if mark fails) ✓
- §6.2 single-chunk failure non-fatal → Task 8 (reports annotationFailed, continues) ✓
- §6.5 refresh/navigation clears annotations naturally → handled by content lifecycle ✓
- §7 file changes → all files listed in File Structure present ✓
- §8 testing strategy → bg/content/panel each have a test file ✓

**Type consistency:** `Annotation`/`AnnotationResult`/`AnnotationPerspective` (Task 1) used consistently in `sw-annotation.ts` (Tasks 2–3), `annotation.ts` content (Tasks 5–8), feature (Task 10). `collectChunks`/`buildFullArticle`/`findAndWrap`/`createIconFor`/`getBubbleHost`/`handleStartAnnotation`/`handleClearAnnotation` signatures match between definition (Tasks 5–8) and consumers (Tasks 9–10). Port message shapes (`annotate`/`annotated`/`error`) match between `sw-annotation.ts` (Task 3) and content `requestChunk` (Task 8) and `service-worker.ts` (Task 4). Runtime message shapes (`annotationProgress`/`annotationDone`/`annotationFailed`/`annotationFollowUp`) match between content (Task 8) and panel (Task 10).
