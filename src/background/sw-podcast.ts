import { safePostMessage } from './sw-utils';

const PODCAST_PROXY_URL = 'http://localhost:3456';

interface NlpText { speaker: string; text: string; }
interface AudioConfig { format: string; sample_rate: number; speech_rate: number; }

export async function callPodcast(nlpTexts: NlpText[], audioConfig: AudioConfig, port: chrome.runtime.Port): Promise<void> {
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId']) as { ttsAppId?: string; ttsAccessKey?: string; ttsResourceId?: string };
  if (!config.ttsAppId || !config.ttsAccessKey) { safePostMessage(port, { type: 'error', errorKey: 'podcast.noTtsConfig' }); return; }

  const connectId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

  try {
    const response = await fetch(`${PODCAST_PROXY_URL}/podcast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: config.ttsAppId, accessKey: config.ttsAccessKey, resourceId: config.ttsResourceId || 'volc.service_type.10050', connectId, nlpTexts, audioConfig }),
    });

    if (!response.ok) { const errText = await response.text().catch(() => ''); throw new Error(`Proxy ${response.status}: ${errText.slice(0, 200)}`); }

    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n'); buffer = events.pop() || '';
      for (const event of events) {
        let eventType = ''; let eventData = '';
        for (const line of event.split('\n')) { const trimmed = line.trim(); if (trimmed.startsWith('event:')) eventType = trimmed.slice(6).trim(); else if (trimmed.startsWith('data:')) eventData = trimmed.slice(5).trim(); }
        if (!eventData) continue;
        try {
          const parsed = JSON.parse(eventData) as { data?: string; idx?: number; speaker?: string; audioDuration?: number; startTime?: number; endTime?: number; error?: string };
          if (eventType === 'audio_chunk' && parsed.data) safePostMessage(port, { type: 'audio_chunk', data: parsed.data });
          else if (eventType === 'round_start') safePostMessage(port, { type: 'round_start', idx: parsed.idx, speaker: parsed.speaker });
          else if (eventType === 'round_end') safePostMessage(port, { type: 'round_end', audioDuration: parsed.audioDuration, startTime: parsed.startTime, endTime: parsed.endTime });
          else if (eventType === 'done') safePostMessage(port, { type: 'done' });
          else if (eventType === 'error') safePostMessage(port, { type: 'error', error: parsed.error || 'Proxy error' });
        } catch { /* skip malformed event */ }
      }
    }
  } catch (e: unknown) {
    console.error('[Podcast] callPodcast error:', (e as Error).message);
    const msg = (e as Error).message?.includes('Failed to fetch') ? 'Podcast proxy not reachable. Start it: cd proxy && npm start' : (e as Error).message;
    safePostMessage(port, { type: 'error', error: msg });
  }
}
