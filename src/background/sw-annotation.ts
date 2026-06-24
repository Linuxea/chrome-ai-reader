import { safePostMessage } from './sw-utils';
import type { Annotation, AnnotationPerspective, AnnotationResult } from '../shared/types';
import { getPrompt } from '../shared/prompts';
import type { Lang } from '../shared/prompts';

interface BuildArgs {
  fullArticle: string;
  chunkIndex: number;
  chunkText: string;
}

/** Assemble system + user messages for one chunk annotation request. */
export function buildAnnotationMessages(
  { fullArticle, chunkIndex, chunkText }: BuildArgs,
  lang: Lang = 'zh',
): { role: 'system' | 'user'; content: string }[] {
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
    { role: 'system', content: getPrompt('annotation.system', lang) },
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
 *
 * Tolerates output that isn't pristine JSON: strips markdown ```json fences
 * and extracts the outermost JSON object from surrounding prose. This is the
 * fallback layer for providers that don't support `response_format=json_object`.
 */
export function parseAnnotationResponse(raw: string): Annotation[] {
  let text = raw.trim();
  // Strip a ```json ... ``` fence if the model wrapped its output (some do
  // even after being told not to).
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) text = fence[1].trim();
  // Tolerate leading/trailing prose: extract the outermost JSON object.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return [];

  let parsed: RawResponse;
  try {
    parsed = JSON.parse(text.slice(first, last + 1)) as RawResponse;
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
 * Once a provider rejects `response_format: json_object`, stop sending it for
 * subsequent chunks. Avoids 15× repeated 400s when annotating a long article on
 * a provider that doesn't support JSON mode (e.g. Volces Ark / deepseek-v4-pro).
 * Reset only by a fresh extension load.
 */
let jsonModeUnsupported = false;

/** Reset the JSON-mode flag. Test accessor only. */
export function __resetJsonModeFlag(): void { jsonModeUnsupported = false; }

/**
 * Annotate one chunk via a non-streaming OpenAI-compatible call with JSON mode.
 * Posts `{type:'annotated', chunkIndex, annotations}` or `{type:'error', error}` to the port.
 * Aborts the request if the port disconnects.
 *
 * JSON-mode downgrade: the first request sends `response_format: json_object`.
 * If the provider returns 400 mentioning `response_format`/`json_object`, the
 * flag is set and the request is retried without that field; all subsequent
 * chunks skip it. The prompt + hardened parser are the fallback layers.
 */
export async function annotateChunk(args: AnnotateArgs, port: chrome.runtime.Port): Promise<void> {
  const { apiKey, apiBase, modelName, language } = (await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName', 'language'])) as {
    apiKey?: string; apiBase?: string; modelName?: string; language?: string;
  };
  const lang: Lang = language === 'en' ? 'en' : 'zh';
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKey' }); return; }
  if (!modelName) { safePostMessage(port, { type: 'error', errorKey: 'error.noModelName' }); return; }

  const baseUrl = apiBase || 'https://api.deepseek.com';
  const controller = new AbortController();
  const onDisconnect = () => controller.abort();
  port.onDisconnect.addListener(onDisconnect);

  try {
    const messages = buildAnnotationMessages(args, lang);
    const buildBody = (withJsonMode: boolean): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model: modelName,
        messages,
        stream: false,
        temperature: 0.7,
      };
      if (withJsonMode) body.response_format = { type: 'json_object' };
      return body;
    };
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

    let withJsonMode = !jsonModeUnsupported;
    let response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(withJsonMode)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errMsg = (errorData as Record<string, { message?: string }>)?.error?.message || '';
      // Downgrade: provider doesn't support response_format=json_object.
      // Retry once without it, then remember for the rest of this session.
      if (withJsonMode && /response_format|json_object/i.test(errMsg)) {
        jsonModeUnsupported = true;
        withJsonMode = false;
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildBody(false)),
          signal: controller.signal,
        });
        if (!response.ok) {
          const err2 = await response.json().catch(() => ({}));
          const msg2 = (err2 as Record<string, { message?: string }>)?.error?.message || `API request failed (${response.status})`;
          safePostMessage(port, { type: 'error', error: msg2 });
          return;
        }
      } else {
        safePostMessage(port, { type: 'error', error: errMsg || `API request failed (${response.status})` });
        return;
      }
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
