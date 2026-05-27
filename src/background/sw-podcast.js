import { safePostMessage } from './sw-utils.js';

// Browser WebSocket API cannot set custom HTTP headers.
// Volcengine Podcast API requires auth headers on the WebSocket handshake.
// Solution: A local Node.js proxy handles the WebSocket with proper headers,
// and streams audio back to this service worker via SSE over HTTP.
// Proxy: cd proxy && npm start → http://localhost:3456

const PODCAST_PROXY_URL = 'http://localhost:3456';

export async function callPodcast(nlpTexts, audioConfig, port) {
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId']);

  if (!config.ttsAppId || !config.ttsAccessKey) {
    safePostMessage(port, { type: 'error', errorKey: 'podcast.noTtsConfig' });
    return;
  }

  const connectId = crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

  try {
    const response = await fetch(`${PODCAST_PROXY_URL}/podcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: config.ttsAppId,
        accessKey: config.ttsAccessKey,
        resourceId: config.ttsResourceId || 'volc.service_type.10050',
        connectId,
        nlpTexts,
        audioConfig,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Proxy ${response.status}: ${errText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        let eventType = '';
        let eventData = '';

        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            eventType = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            eventData = trimmed.slice(5).trim();
          }
        }

        if (!eventData) continue;

        try {
          const parsed = JSON.parse(eventData);

          if (eventType === 'audio_chunk' && parsed.data) {
            safePostMessage(port, { type: 'audio_chunk', data: parsed.data });
          } else if (eventType === 'round_start') {
            safePostMessage(port, { type: 'round_start', idx: parsed.idx, speaker: parsed.speaker });
          } else if (eventType === 'round_end') {
            safePostMessage(port, {
              type: 'round_end',
              audioDuration: parsed.audioDuration,
              startTime: parsed.startTime,
              endTime: parsed.endTime,
            });
          } else if (eventType === 'done') {
            safePostMessage(port, { type: 'done' });
          } else if (eventType === 'error') {
            safePostMessage(port, { type: 'error', error: parsed.error || 'Proxy error' });
          }
        } catch {
          // skip malformed event
        }
      }
    }
  } catch (e) {
    console.error('[Podcast] callPodcast error:', e.message);
    const msg = e.message?.includes('Failed to fetch')
      ? 'Podcast proxy not reachable. Start it: cd proxy && npm start'
      : e.message;
    safePostMessage(port, { type: 'error', error: msg });
  }
}
