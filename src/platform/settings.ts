/**
 * Platform layer — the single typed entry point for user settings.
 *
 * Every setting has one declared home:
 *   - secrets (API keys / access keys) live in `chrome.storage.local` — they
 *     never ride Chrome Sync to other devices or Google's sync servers;
 *   - everything else lives in `chrome.storage.sync`.
 * Callers never pick an area: readSettings / writeSettings / removeSettings /
 * onSettingsChange route each key. Defaults live here too, instead of being
 * repeated at every call site.
 *
 * Secrets written by older versions sit in `sync`; `migrateSecretsToLocal()`
 * (run by the service worker at startup) moves them, and reads fall back to
 * `sync` until it has.
 */

export interface Settings {
  // Chat provider
  provider: 'openai' | 'anthropic';
  apiKey: string;
  apiBase: string;
  modelName: string;
  /** Optional cheaper model for suggestions / titles / annotation / translation. */
  fastModelName: string;
  systemPrompt: string;
  agentMode: boolean;
  citations: boolean;
  // UI
  language: string;
  darkMode: boolean;
  themeName: string;
  suggestQuestions: boolean;
  // Speech
  ttsAppId: string;
  ttsAccessKey: string;
  ttsResourceId: string;
  ttsSpeaker: string;
  ttsAutoPlay: boolean;
  podcastResourceId: string;
  podcastDirect: boolean;
  // Related reading
  embeddingEnabled: boolean;
  embeddingApiKey: string;
  embeddingApiBase: string;
  embeddingModel: string;
  embeddingThreshold: number;
  embeddingMaxPages: number;
}

export type SettingKey = keyof Settings;

/** Keys stored in chrome.storage.local and never exported unless asked. */
export const SECRET_KEYS: readonly SettingKey[] = ['apiKey', 'ttsAccessKey', 'embeddingApiKey'];

export const DEFAULT_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_ANTHROPIC_API_BASE = 'https://api.anthropic.com';

/** Defaults applied on read. Keys absent here read as `undefined` when unset. */
export const SETTING_DEFAULTS: Partial<Settings> = {
  provider: 'openai',
  apiBase: DEFAULT_API_BASE,
  agentMode: false,
  citations: true,
  suggestQuestions: true,
  ttsResourceId: 'seed-tts-2.0',
  ttsSpeaker: 'zh_female_vv_uranus_bigtts',
  ttsAutoPlay: false,
  podcastResourceId: 'volc.service_type.10050',
  podcastDirect: false,
  embeddingEnabled: true,
  embeddingThreshold: 0.7,
  embeddingMaxPages: 200,
};

export const isSecret = (key: string): boolean => (SECRET_KEYS as readonly string[]).includes(key);

function split(keys: readonly string[]): { secret: string[]; plain: string[] } {
  const secret: string[] = [];
  const plain: string[] = [];
  for (const k of keys) (isSecret(k) ? secret : plain).push(k);
  return { secret, plain };
}

/** Empty strings count as unset (the options page stores trimmed input). */
const isSet = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Read settings. Missing values fall back to SETTING_DEFAULTS. A secret not
 * yet migrated is still found in `sync`.
 */
export async function readSettings<K extends SettingKey>(keys: readonly K[]): Promise<Partial<Pick<Settings, K>>> {
  const { secret, plain } = split(keys);
  const [local, sync] = await Promise.all([
    secret.length ? chrome.storage.local.get(secret) : Promise.resolve({} as Record<string, unknown>),
    chrome.storage.sync.get([...plain, ...secret]),
  ]);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = isSecret(k) && isSet(local[k]) ? local[k] : sync[k];
    out[k] = isSet(v) ? v : SETTING_DEFAULTS[k];
  }
  return out as Partial<Pick<Settings, K>>;
}

/** Read settings without applying defaults (the options form shows only what the user set). */
export async function readStoredSettings<K extends SettingKey>(keys: readonly K[]): Promise<Partial<Pick<Settings, K>>> {
  const { secret, plain } = split(keys);
  const [local, sync] = await Promise.all([
    secret.length ? chrome.storage.local.get(secret) : Promise.resolve({} as Record<string, unknown>),
    chrome.storage.sync.get([...plain, ...secret]),
  ]);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = isSecret(k) && isSet(local[k]) ? local[k] : sync[k];
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<Pick<Settings, K>>;
}

/** Write settings, each to its home area. Secrets are also cleared from `sync`. */
export async function writeSettings(values: Partial<Settings>): Promise<void> {
  const secret: Record<string, unknown> = {};
  const plain: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) (isSecret(k) ? secret : plain)[k] = v;
  const ops: Promise<void>[] = [];
  if (Object.keys(plain).length) ops.push(chrome.storage.sync.set(plain));
  if (Object.keys(secret).length) {
    ops.push(chrome.storage.local.set(secret));
    ops.push(chrome.storage.sync.remove(Object.keys(secret)));
  }
  await Promise.all(ops);
}

/** Remove settings from wherever they may be stored. */
export async function removeSettings(keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  const { secret } = split(keys);
  await Promise.all([
    chrome.storage.sync.remove([...keys]),
    secret.length ? chrome.storage.local.remove(secret) : Promise.resolve(),
  ]);
}

/**
 * Move secrets saved by older versions from `sync` to `local`. A value already
 * in `local` wins (it is newer). Idempotent.
 */
export async function migrateSecretsToLocal(): Promise<void> {
  const keys = [...SECRET_KEYS];
  const [sync, local] = await Promise.all([chrome.storage.sync.get(keys), chrome.storage.local.get(keys)]);
  const move: Record<string, unknown> = {};
  const drop: string[] = [];
  for (const k of keys) {
    if (sync[k] === undefined) continue;
    if (!isSet(local[k])) move[k] = sync[k];
    drop.push(k);
  }
  if (Object.keys(move).length) await chrome.storage.local.set(move);
  if (drop.length) await chrome.storage.sync.remove(drop);
}

/**
 * Subscribe to changes of any of `keys` (in their home area). The callback
 * gets only the changed keys' new values. Returns an unsubscribe function.
 */
export function onSettingsChange(keys: readonly SettingKey[], cb: (changed: Partial<Settings>) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const k of keys) {
      if (!(k in changes)) continue;
      const home = isSecret(k) ? 'local' : 'sync';
      // A secret removed from sync during migration is not a user change.
      if (area !== home) continue;
      changed[k] = changes[k].newValue;
      any = true;
    }
    if (any) cb(changed as Partial<Settings>);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
