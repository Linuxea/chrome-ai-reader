import { safePostMessage } from './sw-utils';
import type { Annotation, AnnotationPerspective, AnnotationResult } from '../shared/types';
import { getPrompt } from '../shared/prompts';
import { genId } from '../shared/ids';
import { readSettings } from '../platform/settings';
import { completeChat } from './chat-runner';
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
  return [
    { role: 'system', content: getPrompt('annotation.system', lang) },
    { role: 'user', content: getPrompt('annotation.user', lang, { fullArticle, chunkIndex: String(chunkIndex), chunkText }) },
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

interface AnnotateArgs {
  fullArticle: string;
  chunkIndex: number;
  chunkText: string;
}

/**
 * Annotate one chunk: a JSON-mode completion through the shared chat runner
 * ('light' purpose → the fast model when one is configured). Posts
 * `{type:'annotated', chunkIndex, annotations}` or `{type:'error', …}`.
 * Aborts when the port disconnects.
 *
 * Providers that reject JSON mode are downgraded once and remembered by the
 * provider layer (providers/capabilities.ts); the prompt + hardened parser
 * are the fallback.
 */
export async function annotateChunk(args: AnnotateArgs, port: chrome.runtime.Port): Promise<void> {
  const { language } = await readSettings(['language']);
  const lang: Lang = language === 'en' ? 'en' : 'zh';
  const controller = new AbortController();
  const onDisconnect = () => controller.abort();
  port.onDisconnect.addListener(onDisconnect);
  try {
    const { text } = await completeChat({
      messages: buildAnnotationMessages(args, lang),
      purpose: 'light',
      jsonMode: true,
      temperature: 0.7,
      signal: controller.signal,
    });
    const result: AnnotationResult = { chunkIndex: args.chunkIndex, annotations: parseAnnotationResponse(text) };
    safePostMessage(port, { type: 'annotated', ...result });
  } catch (e: unknown) {
    if (controller.signal.aborted) return;
    const errorKey = (e as { errorKey?: string }).errorKey;
    safePostMessage(port, errorKey ? { type: 'error', errorKey } : { type: 'error', error: (e as Error).message });
  } finally {
    port.onDisconnect.removeListener(onDisconnect);
  }
}

