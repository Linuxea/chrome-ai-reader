import { safePostMessage } from './sw-utils.js';

export async function callTTS(text, port) {
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId', 'ttsSpeaker']);

  if (!config.ttsAppId || !config.ttsAccessKey) {
    safePostMessage(port, { type: 'error', errorKey: 'error.noTtsConfig' });
    return;
  }

  const resourceId = config.ttsResourceId || 'seed-tts-2.0';
  const speaker = config.ttsSpeaker || 'zh_female_vv_uranus_bigtts';
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  try {
    const response = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Id': config.ttsAppId,
        'X-Api-Access-Key': config.ttsAccessKey,
        'X-Api-Resource-Id': resourceId
      },
      body: JSON.stringify({
        user: { uid: 'chrome-ext' },
        req_params: {
          text: text,
          speaker: speaker,
          audio_params: { format: 'mp3', sample_rate: 24000 },
          additions: '{"disable_markdown_filter":true}'
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`TTS request failed (${response.status})${errorText ? ': ' + errorText.slice(0, 200) : ''}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedAudio = false;

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

          if (parsed.code && parsed.code !== 0 && parsed.code !== 20000000) {
            safePostMessage(port, { type: 'error', errorKey: 'error.ttsError', error: parsed.message || `TTS error (code: ${parsed.code})` });
            return;
          }

          if (eventType === '352' && parsed.data) {
            receivedAudio = true;
            safePostMessage(port, { type: 'chunk', data: parsed.data });
          } else if (eventType === '153') {
            safePostMessage(port, { type: 'error', errorKey: 'error.ttsSynthFailed', error: parsed.message || 'TTS synthesis failed' });
            return;
          } else if (eventType === '152' && receivedAudio) {
            safePostMessage(port, { type: 'done' });
            return;
          }
        } catch {
          // skip
        }
      }
    }

    safePostMessage(port, { type: 'done' });
  } catch (e) {
    safePostMessage(port, { type: 'error', error: e.message });
  }
}
