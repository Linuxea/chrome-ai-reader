import { callOpenAI, callSuggestQuestions, callEmbedding } from './sw-openai';
import { callTTS } from './sw-tts';
import { callPodcast } from './sw-podcast';
import { annotateChunk } from './sw-annotation';
import { handlePageRecordsMessage } from './sw-related-pages';
import { PORT_NAMES } from '../shared/protocol';
import { migrateSecretsToLocal, DEFAULT_API_BASE } from '../platform/settings';
import type { PodcastLLMRequest } from '../shared/protocol';
import type { MessageContentPart } from '../shared/types';

// Secrets saved by older versions lived in storage.sync; move them to local.
migrateSecretsToLocal().catch((e: unknown) => console.error('secret migration failed:', e));

chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  chrome.sidePanel.open({ tabId: tab.id! });
});

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === 'ai-chat') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'chat') await callOpenAI(msg.messages as { role: string; content: string }[], port, { response_format: msg.response_format as Record<string, unknown> | undefined, temperature: msg.temperature as number | undefined });
    });
  } else if (port.name === 'tts' || port.name === 'tts-download') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'tts') await callTTS(msg.text as string, port);
    });
  } else if (port.name === 'suggest-questions') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'suggest') await callSuggestQuestions(msg.messages as { role: string; content: string }[], port);
    });
  } else if (port.name === 'podcast-llm') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'generate') {
        await callOpenAI([buildPodcastUserMessage(msg as unknown as PodcastLLMRequest)], port, { response_format: { type: 'json_object' } });
      }
    });
  } else if (port.name === 'podcast-audio') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'generate') await callPodcast(msg.nlpTexts as { speaker: string; text: string }[], msg.audioConfig as { format: string; sample_rate: number; speech_rate: number }, port);
    });
  } else if (port.name === PORT_NAMES.EMBEDDING) {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'embed') await callEmbedding(msg.text as string, port);
    });
  } else if (port.name === 'annotation') {
    port.onMessage.addListener(async (msg: Record<string, unknown>) => {
      if (msg.type === 'annotate') {
        await annotateChunk(
          {
            fullArticle: msg.fullArticle as string,
            chunkIndex: msg.chunkIndex as number,
            chunkText: msg.chunkText as string,
          },
          port,
        );
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg: Record<string, unknown>, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  if (msg.action === 'selectionChanged' && !msg.forwarded) {
    chrome.runtime.sendMessage({ action: 'selectionChanged', text: msg.text, tabId: sender.tab?.id, forwarded: true }).catch(() => {});
  }

  if (msg.action === 'fetchModels') {
    const baseUrl = (msg.apiBase as string) || DEFAULT_API_BASE;
    fetch(`${baseUrl}/models`, { method: 'GET', headers: { 'Authorization': `Bearer ${msg.apiKey}` } })
      .then(res => { if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`); return res.json(); })
      .then((data: Record<string, unknown>) => { const models = ((data.data as { id: string }[]) || []).map(m => m.id); sendResponse({ success: true, models }); })
      .catch((e: Error) => { sendResponse({ success: false, error: e.message }); });
    return true;
  }


  if (msg.action === 'pageRecords:store' || msg.action === 'pageRecords:findRelated') {
    return handlePageRecordsMessage(msg, sendResponse);
  }
});

/** Podcast script request → one user message; pending images become image_url parts. */
export function buildPodcastUserMessage(req: PodcastLLMRequest): { role: 'user'; content: string | MessageContentPart[] } {
  const text = `${req.prompt}\n\n${req.text}`;
  if (!req.images || req.images.length === 0) return { role: 'user', content: text };
  const parts: MessageContentPart[] = [{ type: 'text', text }];
  for (const url of req.images) parts.push({ type: 'image_url', image_url: { url } });
  return { role: 'user', content: parts };
}
