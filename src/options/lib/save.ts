/**
 * Persist decisions for the immediate-save model (D-2, 2026-11-24).
 *
 * Timing lives in settings-store (toggles/selects write on change; text
 * fields debounce + flush on blur). This module owns the per-field
 * DECISIONS that the legacy collectLlmSaveData / collectTtsSaveData
 * encoded, so they survive the React rewrite byte-for-byte:
 *
 *   - a trimmed-empty text value REMOVES the key (never stores ''), and
 *   - the retired keys the old save button swept on every click are
 *     swept once per options load instead.
 */
import {
  removeSettings,
  writeSettings,
  type SettingKey,
  type Settings,
} from '@/platform/settings';

/**
 * Retired with their features (vision / GLM-OCR / fast-model split / the
 * F11 agent tool loop) — no longer part of the Settings interface, removed
 * by raw key. `fastModelName` and `agentMode` are also removed by the SW at
 * startup (cleanupRemovedSettings); sweeping here is idempotent either way.
 */
export const RETIRED_SAVE_KEYS: readonly string[] = [
  'visionEnabled',
  'ocrApiKey',
  'fastModelName',
  'agentMode',
];

/** One-time cleanup for retired settings, run at options load. */
export async function sweepRetiredSaveKeys(): Promise<void> {
  await removeSettings(RETIRED_SAVE_KEYS);
}

/**
 * Persist one text field, trimmed. Empty → remove the key (the read path
 * treats '' as unset; storing it would shadow nothing and confuse the
 * "show only what the user set" form). Returns whether a value was
 * written (false = removed / left unset) — callers use it e.g. to skip
 * the automatic model refresh for a cleared apiKey.
 */
export async function persistTextField(key: SettingKey, raw: string): Promise<boolean> {
  const value = raw.trim();
  if (!value) {
    await removeSettings([key]);
    return false;
  }
  const patch: Partial<Settings> = {};
  (patch as Record<SettingKey, unknown>)[key] = value;
  await writeSettings(patch);
  return true;
}

/** Text fields that share the debounced persist path. */
export const TEXT_FIELD_KEYS = [
  'apiKey',
  'apiBase',
  'modelName',
  'systemPrompt',
  'ttsAppId',
  'ttsAccessKey',
  'ttsResourceId',
  'podcastResourceId',
  'ttsSpeaker',
] as const satisfies readonly SettingKey[];

export type TextFieldKey = (typeof TEXT_FIELD_KEYS)[number];

/**
 * Per-field debounce scheduler: typing reschedules, blur flushes the
 * latest payload immediately, flushAll drains everything (used on
 * page hide so a draft is never lost). Timeouts are injectable for tests.
 */
export interface PersistScheduler {
  schedule(key: TextFieldKey, raw: string): void;
  flush(key: TextFieldKey): void;
  flushAll(): void;
  cancel(key: TextFieldKey): void;
}

export const TEXT_PERSIST_DEBOUNCE_MS = 500;

export function createPersistScheduler(
  persist: (key: TextFieldKey, raw: string) => Promise<unknown>,
  debounceMs: number = TEXT_PERSIST_DEBOUNCE_MS,
): PersistScheduler {
  const timers = new Map<TextFieldKey, ReturnType<typeof setTimeout>>();
  const payloads = new Map<TextFieldKey, string>();

  const run = (key: TextFieldKey): void => {
    const timer = timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(key);
    const raw = payloads.get(key) ?? '';
    payloads.delete(key);
    void persist(key, raw);
  };

  return {
    schedule(key, raw) {
      payloads.set(key, raw);
      const timer = timers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      timers.set(
        key,
        setTimeout(() => run(key), debounceMs),
      );
    },
    flush(key) {
      if (timers.has(key)) run(key);
    },
    flushAll() {
      for (const key of [...timers.keys()]) run(key);
    },
    cancel(key) {
      const timer = timers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(key);
      payloads.delete(key);
    },
  };
}
