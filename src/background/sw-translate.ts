/**
 * F7 — immersive translation, worker side. The content script sends
 * paragraphs in batches on the `translate` port; each batch is answered from
 * the per-paragraph cache (IndexedDB `translations`, keyed by target
 * language + text hash, so a paragraph is paid for once across visits and
 * pages) and the rest is translated in one JSON-mode request on the fast
 * model.
 */

import { safePostMessage } from './sw-utils';
import { completeChat } from './chat-runner';
import { readSettings } from '../platform/settings';
import { dbGet, dbPut } from '../shared/db';
import { hashText } from '../shared/highlights';
import { getPrompt, type Lang } from '../shared/prompts';
import { stripMarkdownFence, extractJsonObject, repairLLMJson } from '../shared/json-repair';

interface CachedTranslation { key: string; text: string }

const cacheKey = (lang: Lang, text: string): string => `${lang}|${hashText(text)}`;

/** Parse `{"translations": [...]}`, tolerating fences / prose / broken JSON. Never throws. */
export function parseTranslations(raw: string, expected: number): string[] {
  const out: string[] = new Array(expected).fill('');
  const json = extractJsonObject(stripMarkdownFence(raw), 'translations') ?? extractJsonObject(raw);
  if (!json) return out;
  let parsed: { translations?: unknown };
  try { parsed = JSON.parse(json); } catch {
    try { parsed = JSON.parse(repairLLMJson(json)); } catch { return out; }
  }
  const list = Array.isArray(parsed.translations) ? parsed.translations : [];
  for (let i = 0; i < expected; i++) out[i] = typeof list[i] === 'string' ? (list[i] as string).trim() : '';
  return out;
}

export async function translateBatch(texts: string[], lang: Lang, signal?: AbortSignal): Promise<string[]> {
  const keys = texts.map((t) => cacheKey(lang, t));
  const cached = await Promise.all(keys.map((k) => dbGet<CachedTranslation>('translations', k).catch(() => undefined)));
  const result = cached.map((c) => c?.text ?? '');
  const missing = texts.map((_, i) => i).filter((i) => !cached[i]);
  if (!missing.length) return result;

  const { text } = await completeChat({
    messages: [
      { role: 'system', content: getPrompt('immersive.system', lang) },
      { role: 'user', content: JSON.stringify({ paragraphs: missing.map((i) => texts[i]) }) },
    ],
    purpose: 'light',
    jsonMode: true,
    temperature: 0.3,
    signal,
  });
  const translated = parseTranslations(text, missing.length);
  await Promise.all(missing.map(async (i, k) => {
    result[i] = translated[k];
    if (translated[k]) await dbPut('translations', { key: keys[i], text: translated[k] }).catch(() => {});
  }));
  return result;
}

/** Port handler: {type:'translate', id, texts} → {type:'translated', id, translations} | {type:'error', id, …}. */
export async function handleTranslate(msg: { id?: number; texts?: string[] }, port: chrome.runtime.Port): Promise<void> {
  const controller = new AbortController();
  const onGone = () => controller.abort();
  port.onDisconnect.addListener(onGone);
  try {
    const { language } = await readSettings(['language']);
    const lang: Lang = language === 'en' ? 'en' : 'zh';
    const translations = await translateBatch(msg.texts ?? [], lang, controller.signal);
    safePostMessage(port, { type: 'translated', id: msg.id, translations });
  } catch (e) {
    if (controller.signal.aborted) return;
    const errorKey = (e as { errorKey?: string }).errorKey;
    safePostMessage(port, { type: 'error', id: msg.id, errorKey, error: (e as Error).message });
  } finally {
    port.onDisconnect.removeListener(onGone);
  }
}
