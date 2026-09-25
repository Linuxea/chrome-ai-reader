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
import { migrateSecretsToLocal, DEFAULT_API_BASE } from '../platform/settings';
import type { PodcastLLMRequest } from '../shared/protocol';
import type { MessageContentPart } from '../shared/types';

// Secrets saved by older versions lived in storage.sync; move them to local.
migrateSecretsToLocal().catch((e: unknown) => console.error('secret migration failed:', e));

chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  chrome.sidePanel.open({ tabId: tab.id! });
});

// --- Ports (streaming) -------------------------------------------------------

registerPort(PORT_NAMES.AI_CHAT, 'extension', async (msg, port) => {
  const req = msg as unknown as AIChatRequest & { temperature?: number };
  if (req.type === 'chat') await callOpenAI(req.messages, port, { response_format: req.response_format as Record<string, unknown> | undefined, temperature: req.temperature });
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

// --- One-shot messages ---------------------------------------------------------

registerMessage('selectionChanged', 'content', (msg, sender) => {
  const m = msg as unknown as SelectionChangedMessage;
  if (!m.forwarded) {
    chrome.runtime.sendMessage({ action: 'selectionChanged', text: m.text, tabId: sender.tab?.id, forwarded: true }).catch(() => {});
  }
});

registerMessage('fetchModels', 'extension', (msg, _sender, sendResponse) => {
  const m = msg as unknown as FetchModelsMessage;
  const baseUrl = m.apiBase || DEFAULT_API_BASE;
  fetch(`${baseUrl}/models`, { method: 'GET', headers: { 'Authorization': `Bearer ${m.apiKey}` } })
    .then(res => { if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`); return res.json(); })
    .then((data: Record<string, unknown>) => { const models = ((data.data as { id: string }[]) || []).map(x => x.id); sendResponse({ success: true, models }); })
    .catch((e: Error) => { sendResponse({ success: false, error: e.message }); });
  return true;
});

registerMessage('pageRecords:store', 'extension', (msg, _sender, sendResponse) => handlePageRecordsMessage(msg, sendResponse));
registerMessage('pageRecords:findRelated', 'extension', (msg, _sender, sendResponse) => handlePageRecordsMessage(msg, sendResponse));

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
