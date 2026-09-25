import { callOpenAI, callSuggestQuestions, callEmbedding } from './sw-openai';
import { callTTS } from './sw-tts';
import { callPodcast } from './sw-podcast';
import { annotateChunk } from './sw-annotation';
import { handlePageRecordsMessage } from './sw-related-pages';
import { PORT_NAMES } from '../shared/protocol';
import type {
  AIChatRequest, TTSRequest, SuggestRequest, PodcastAudioRequest, EmbeddingRequest, AnnotationRequest,
  SelectionChangedMessage, FetchModelsMessage,
} from '../shared/protocol';
import { registerPort, registerMessage, dispatchConnect, dispatchMessage } from './sw-router';
import {
  addHighlight, listHighlights, updateHighlightNote, deleteHighlight, allHighlights,
  getCachedAnnotations, saveCachedAnnotations, respond,
} from './sw-highlights';
import type { AnnotationCacheEntry } from '../shared/highlights';
import { migrateSecretsToLocal, onSettingsChange, DEFAULT_API_BASE, DEFAULT_ANTHROPIC_API_BASE } from '../platform/settings';
import { setupContextMenus, onMenuClicked, onCommand } from './sw-menus';
import { handleTranslate } from './sw-translate';
import { listAnthropicModels } from './providers/anthropic';
import type { PodcastLLMRequest } from '../shared/protocol';
import type { MessageContentPart } from '../shared/types';

// Secrets saved by older versions lived in storage.sync; move them to local.
migrateSecretsToLocal().catch((e: unknown) => console.error('secret migration failed:', e));

// F8: context menu + shortcuts. Menus are rebuilt on install/startup and
// when the UI language changes (their titles follow it).
chrome.runtime.onInstalled?.addListener(() => { void setupContextMenus(); });
chrome.runtime.onStartup?.addListener(() => { void setupContextMenus(); });
onSettingsChange(['language'], () => { void setupContextMenus(); });
chrome.contextMenus?.onClicked.addListener(onMenuClicked);
chrome.commands?.onCommand.addListener(onCommand);

chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  chrome.sidePanel.open({ tabId: tab.id! });
});

// --- Ports (streaming) -------------------------------------------------------

registerPort(PORT_NAMES.AI_CHAT, 'extension', async (msg, port) => {
  const req = msg as unknown as AIChatRequest;
  if (req.type === 'chat') {
    await callOpenAI(req.messages, port, {
      response_format: req.response_format as Record<string, unknown> | undefined,
      temperature: req.temperature,
      purpose: req.purpose,
      tools: req.purpose === 'agent' ? req.tools : undefined,
    });
  }
});

const ttsHandler = async (msg: Record<string, unknown>, port: chrome.runtime.Port) => {
  const req = msg as unknown as TTSRequest;
  if (req.type === 'tts') await callTTS(req.text, port);
};
registerPort(PORT_NAMES.TTS, 'extension', ttsHandler);
registerPort(PORT_NAMES.TTS_DOWNLOAD, 'extension', ttsHandler);

registerPort(PORT_NAMES.SUGGEST_QUESTIONS, 'extension', async (msg, port) => {
  const req = msg as unknown as SuggestRequest;
  if (req.type === 'suggest') await callSuggestQuestions(req.messages, port);
});

registerPort(PORT_NAMES.PODCAST_LLM, 'extension', async (msg, port) => {
  if (msg.type === 'generate') {
    await callOpenAI([buildPodcastUserMessage(msg as unknown as PodcastLLMRequest)], port, { response_format: { type: 'json_object' } });
  }
});

registerPort(PORT_NAMES.PODCAST_AUDIO, 'extension', async (msg, port) => {
  const req = msg as unknown as PodcastAudioRequest;
  if (req.type === 'generate') await callPodcast(req.nlpTexts, req.audioConfig, port);
});

registerPort(PORT_NAMES.EMBEDDING, 'extension', async (msg, port) => {
  const req = msg as unknown as EmbeddingRequest;
  if (req.type === 'embed') await callEmbedding(req.text, port);
});

// Opened by the content script (deep annotation runs in the page).
registerPort(PORT_NAMES.ANNOTATION, 'content', async (msg, port) => {
  const req = msg as unknown as AnnotationRequest;
  if (req.type === 'annotate') {
    await annotateChunk({ fullArticle: req.fullArticle, chunkIndex: req.chunkIndex, chunkText: req.chunkText }, port);
  }
});

// F7: immersive translation batches from the content script.
registerPort(PORT_NAMES.TRANSLATE, 'content', async (msg, port) => {
  if (msg.type === 'translate') await handleTranslate(msg as { id?: number; texts?: string[] }, port);
});

// --- One-shot messages ---------------------------------------------------------

registerMessage('selectionChanged', 'content', (msg, sender) => {
  const m = msg as unknown as SelectionChangedMessage;
  if (!m.forwarded) {
    chrome.runtime.sendMessage({ action: 'selectionChanged', text: m.text, tabId: sender.tab?.id, forwarded: true }).catch(() => {});
  }
});

registerMessage('fetchModels', 'extension', (msg, _sender, sendResponse) => {
  const m = msg as unknown as FetchModelsMessage;
  if (m.provider === 'anthropic') {
    listAnthropicModels(m.apiKey ?? '', m.apiBase || DEFAULT_ANTHROPIC_API_BASE)
      .then((models) => sendResponse({ success: true, models }))
      .catch((e: Error) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  const baseUrl = m.apiBase || DEFAULT_API_BASE;
  fetch(`${baseUrl}/models`, { method: 'GET', headers: { 'Authorization': `Bearer ${m.apiKey}` } })
    .then(res => { if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`); return res.json(); })
    .then((data: Record<string, unknown>) => { const models = ((data.data as { id: string }[]) || []).map(x => x.id); sendResponse({ success: true, models }); })
    .catch((e: Error) => { sendResponse({ success: false, error: e.message }); });
  return true;
});

registerMessage('pageRecords:store', 'extension', (msg, _sender, sendResponse) => handlePageRecordsMessage(msg, sendResponse));
registerMessage('pageRecords:findRelated', 'extension', (msg, _sender, sendResponse) => handlePageRecordsMessage(msg, sendResponse));
registerMessage('pageRecords:search', 'extension', (msg, _sender, sendResponse) => handlePageRecordsMessage(msg, sendResponse));

// F6: highlights/notes and the annotation cache (IndexedDB lives here).
registerMessage('highlights:add', 'content', (msg, sender, sendResponse) => respond(addHighlight({
  exact: String(msg.exact ?? ''), prefix: String(msg.prefix ?? ''), suffix: String(msg.suffix ?? ''),
  pageUrl: String(msg.pageUrl ?? sender.tab?.url ?? ''), title: String(msg.title ?? sender.tab?.title ?? ''), note: String(msg.note ?? ''),
}), sendResponse, 'highlight'));
registerMessage('highlights:list', 'content', (msg, sender, sendResponse) =>
  respond(listHighlights(String(msg.pageUrl ?? sender.tab?.url ?? '')), sendResponse, 'highlights'));
registerMessage('highlights:update', 'extension', (msg, _s, sendResponse) => respond(updateHighlightNote(String(msg.id), String(msg.note ?? '')), sendResponse));
registerMessage('highlights:delete', 'extension', (msg, _s, sendResponse) => respond(deleteHighlight(String(msg.id)), sendResponse));
registerMessage('highlights:all', 'extension', (_m, _s, sendResponse) => respond(allHighlights(), sendResponse, 'highlights'));
registerMessage('annotations:get', 'content', (msg, _s, sendResponse) => respond(getCachedAnnotations(String(msg.key)), sendResponse, 'entry'));
registerMessage('annotations:save', 'content', (msg, _s, sendResponse) => respond(saveCachedAnnotations({
  key: String(msg.key), results: (msg.results as AnnotationCacheEntry['results']) ?? [], createdAt: Date.now(),
}), sendResponse));

chrome.runtime.onConnect.addListener(dispatchConnect);
chrome.runtime.onMessage.addListener(dispatchMessage);

/** Podcast script request → one user message; pending images become image_url parts. */
export function buildPodcastUserMessage(req: PodcastLLMRequest): { role: 'user'; content: string | MessageContentPart[] } {
  const text = `${req.prompt}\n\n${req.text}`;
  if (!req.images || req.images.length === 0) return { role: 'user', content: text };
  const parts: MessageContentPart[] = [{ type: 'text', text }];
  for (const url of req.images) parts.push({ type: 'image_url', image_url: { url } });
  return { role: 'user', content: parts };
}
