import { safePostMessage } from './sw-utils';
import type { Annotation, AnnotationPerspective, AnnotationResult } from '../shared/types';

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
    const result: AnnotationResult = { chunkIndex: args.chunkIndex, annotations: parseAnnotationResponse(raw) };
    safePostMessage(port, { type: 'annotated', ...result });
  } catch (e: unknown) {
    safePostMessage(port, { type: 'error', error: (e as Error).message });
  } finally {
    port.onDisconnect.removeListener(onDisconnect);
  }
}

// Re-exported for sw-annotation fetch layer (Task 3); harmless if unused in isolation tests.
export { safePostMessage };
