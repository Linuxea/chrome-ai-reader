/**
 * Per-segment TTS audio cache (IndexedDB store `ttsAudio`, see shared/db.ts).
 *
 * Every synthesized segment mp3 is stored under
 * `sha-256(resourceId | speaker | format | sampleRate | text)` so that:
 *  - replays / downloads of the same message in the same voice cost nothing
 *    (the API bills per character — only successful tasks are billed)
 *  - play / autoplay / download share one cache, because all three paths use
 *    the same deterministic segmentation (services/tts/utils.ts)
 *
 * Eviction is LRU by `lastUsedAt` with a byte cap; the running total is kept
 * in a `_meta__` record so writes don't have to scan the store.
 *
 * Used from the side panel and the options page. Import-safe everywhere:
 * storage access is lazy and every read failure degrades to a cache miss.
 */

import { dbPut, dbGet, dbDelete, dbClear, openDB } from './db';
import { TTS_AUDIO_PARAMS, type TTSSynthVoice } from './tts-params';

/** Soft byte cap before LRU pruning kicks in. */
export const TTS_CACHE_CAP_BYTES = 150 * 1024 * 1024;
let _capBytes = TTS_CACHE_CAP_BYTES;
/** Test seam: shrink the cap to exercise LRU pruning without 150MB of blobs. */
export function __setTtsCacheCapForTesting(bytes: number): void { _capBytes = bytes; }
/** Prune down to this fraction of the cap (hysteresis). */
const PRUNE_TARGET_RATIO = 0.9;
const META_KEY = '__meta__';

export interface TTSSegmentRecord {
  key: string;
  blob: Blob;
  bytes: number;
  createdAt: number;
  lastUsedAt: number;
}

interface TTSMetaRecord {
  key: string;
  bytes: number;
}

/** Stable cache key for one segment's audio (voice + audio params + exact text). */
export async function ttsCacheKey(voice: TTSSynthVoice, text: string): Promise<string> {
  const input = [
    voice.resourceId, voice.speaker, TTS_AUDIO_PARAMS.format,
    String(TTS_AUDIO_PARAMS.sampleRate), text,
  ].join('\u0000');
  return digestHex(input);
}

async function digestHex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    } catch { /* fall through to the deterministic fallback */ }
  }
  // Non-secure contexts / minimal test environments: deterministic 4×FNV-1a.
  // Only needs uniqueness-per-input, not cryptographic strength.
  let out = '';
  for (let lane = 0; lane < 4; lane++) out += fnv1a(input, 0x811c9dc5 + lane * 0x9e3779b9);
  return out;
}

function fnv1a(input: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Cached audio for a segment, or null on miss / corruption (corrupt rows are dropped). */
export async function getCachedSegmentAudio(key: string): Promise<Blob | null> {
  try {
    const rec = await dbGet<TTSSegmentRecord>('ttsAudio', key);
    if (!rec) return null;
    if (typeof rec.blob?.size !== 'number') {
      await dbDelete('ttsAudio', key).catch(() => {});
      return null;
    }
    // LRU touch — fire and forget; failing to touch only affects eviction order.
    dbPut('ttsAudio', { ...rec, lastUsedAt: Date.now() }).catch(() => {});
    return rec.blob;
  } catch {
    return null;
  }
}

/** Store one segment's complete mp3, then prune if over the cap. Never throws for quota reasons. */
export async function putSegmentAudio(key: string, blob: Blob): Promise<void> {
  try {
    const prev = await dbGet<TTSSegmentRecord>('ttsAudio', key).catch(() => undefined);
    const delta = blob.size - (prev?.bytes ?? 0);
    const rec: TTSSegmentRecord = { key, blob, bytes: blob.size, createdAt: Date.now(), lastUsedAt: Date.now() };
    await dbPut('ttsAudio', rec);
    if (delta !== 0) await addMetaBytes(delta);
    await pruneIfOverCap();
  } catch { /* quota / storage failure — the cache is best-effort */ }
}

async function readMetaBytes(): Promise<number> {
  try {
    const meta = await dbGet<TTSMetaRecord>('ttsAudio', META_KEY);
    return meta?.bytes ?? 0;
  } catch {
    return 0;
  }
}

async function addMetaBytes(delta: number): Promise<void> {
  const bytes = Math.max(0, (await readMetaBytes()) + delta);
  await dbPut('ttsAudio', { key: META_KEY, bytes } as unknown as TTSSegmentRecord).catch(() => {});
}

/** Delete least-recently-used segments until the cache is under cap × ratio. */
async function pruneIfOverCap(): Promise<void> {
  const total = await readMetaBytes();
  if (total <= _capBytes) return;

  const target = _capBytes * PRUNE_TARGET_RATIO;
  let freed = 0;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      const tx = db.transaction('ttsAudio', 'readwrite');
      const req = tx.objectStore('ttsAudio').index('lastUsedAt').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || total - freed <= target) { done(); return; }
        const rec = cursor.value as TTSSegmentRecord;
        if (rec && rec.key !== META_KEY) {
          freed += rec.bytes || 0;
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => done();
      tx.onabort = () => done();
    });
  } catch { /* pruning is best-effort */ }
  if (freed > 0) await addMetaBytes(-freed).catch(() => {});
}

/** Total cached bytes (best-effort meta; 0 when storage is unavailable). */
export async function estimateTtsCacheBytes(): Promise<number> {
  return readMetaBytes();
}

/** Wipe the cache and reset the accounting record. */
export async function clearTtsCache(): Promise<void> {
  await dbClear('ttsAudio');
}
