/**
 * Platform layer — typed wrappers over `chrome.runtime` Port connections.
 *
 * All long-lived streaming channels (`chrome.runtime.connect`) are opened
 * through this module so that the wire contract (defined in
 * `shared/protocol.ts`) is enforced on the client side. The background worker
 * remains a plain dispatcher; this file only helps the *consumers* (side panel
 * + content script) open ports and post typed messages.
 *
 * Rationale: `chrome.runtime.connect({ name: 'ai-chat' })` previously appeared
 * verbatim in 10 call sites with ad-hoc `postMessage` shapes. Centralizing the
 * open + post removes protocol drift and gives tests a single seam to mock.
 */

import { PORT_NAMES, type PortName } from '../shared/protocol';

/**
 * Open a typed Port. The returned object preserves the underlying
 * `chrome.runtime.Port` so callers can attach `onMessage` / `onDisconnect`
 * listeners (the message bodies are still parsed by the caller using the
 * protocol types from `shared/protocol.ts`).
 */
export function openPort(name: PortName): chrome.runtime.Port {
  return chrome.runtime.connect({ name });
}

// --- Convenience constructors per port name ---------------------------------
// These exist so call sites read as intent ("open the AI chat port") rather
// than magic strings, and so renames touch one place.

export const openAIChatPort = (): chrome.runtime.Port => openPort(PORT_NAMES.AI_CHAT);
export const openTTSPort = (): chrome.runtime.Port => openPort(PORT_NAMES.TTS);
export const openTTSDownloadPort = (): chrome.runtime.Port => openPort(PORT_NAMES.TTS_DOWNLOAD);
export const openSuggestPort = (): chrome.runtime.Port => openPort(PORT_NAMES.SUGGEST_QUESTIONS);
export const openPodcastLLMPort = (): chrome.runtime.Port => openPort(PORT_NAMES.PODCAST_LLM);
export const openPodcastAudioPort = (): chrome.runtime.Port => openPort(PORT_NAMES.PODCAST_AUDIO);
export const openEmbeddingPort = (): chrome.runtime.Port => openPort(PORT_NAMES.EMBEDDING);
export const openAnnotationPort = (): chrome.runtime.Port => openPort(PORT_NAMES.ANNOTATION);
