// service_worker.js -- 后台服务：调用 OpenAI API

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

function safePostMessage(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    // Port may have been disconnected by the client side
  }
}

async function callOpenAI(messages, port, options) {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);

  if (!apiKey) {
    safePostMessage(port, { type: 'error', errorKey: 'error.noApiKey' });
    return;
  }

  const baseUrl = apiBase || 'https://api.deepseek.com';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify((() => {
        const requestBody = {
          model: modelName || 'deepseek-chat',
          messages: messages,
          stream: true,
          temperature: 0.7
        };
        if (options?.response_format) {
          requestBody.response_format = options.response_format;
        }
        return requestBody;
      })())
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          safePostMessage(port, { type: 'done' });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            safePostMessage(port, { type: 'thinking', content: delta.reasoning_content });
          }
          if (delta?.content) {
            safePostMessage(port, { type: 'chunk', content: delta.content });
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

async function callTTS(text, port) {
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId', 'ttsSpeaker']);

  if (!config.ttsAppId || !config.ttsAccessKey) {
    safePostMessage(port, { type: 'error', errorKey: 'error.noTtsConfig' });
    return;
  }

  const resourceId = config.ttsResourceId || 'seed-tts-2.0';
  const speaker = config.ttsSpeaker || 'zh_female_vv_uranus_bigtts';

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
      })
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
          } else {
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

async function callSuggestQuestions(messages, port) {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);

  if (!apiKey) {
    safePostMessage(port, { type: 'error', errorKey: 'error.noApiKeySuggest' });
    return;
  }

  const baseUrl = apiBase || 'https://api.deepseek.com';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName || 'deepseek-chat',
        messages: messages,
        stream: true,
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          safePostMessage(port, { type: 'done' });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            safePostMessage(port, { type: 'chunk', content: delta.content });
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

// --- Podcast Audio (WebSocket binary protocol) ---

function encodePodcastFrame(eventCode, sessionId, payloadObj) {
  const header = new Uint8Array([0x11, 0x94, 0x10, 0x00]);
  const eventBytes = new Uint8Array(4);
  new DataView(eventBytes.buffer).setUint32(0, eventCode, false);

  const sessionIdBytes = new TextEncoder().encode(sessionId);
  const sessionIdLen = new Uint8Array(4);
  new DataView(sessionIdLen.buffer).setUint32(0, sessionIdBytes.length, false);

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const payloadLen = new Uint8Array(4);
  new DataView(payloadLen.buffer).setUint32(0, payloadBytes.length, false);

  const frame = new Uint8Array(
    header.length + eventBytes.length +
    sessionIdLen.length + sessionIdBytes.length +
    payloadLen.length + payloadBytes.length
  );
  let offset = 0;
  frame.set(header, offset); offset += header.length;
  frame.set(eventBytes, offset); offset += eventBytes.length;
  frame.set(sessionIdLen, offset); offset += sessionIdLen.length;
  frame.set(sessionIdBytes, offset); offset += sessionIdBytes.length;
  frame.set(payloadLen, offset); offset += payloadLen.length;
  frame.set(payloadBytes, offset);
  return frame;
}

function decodePodcastFrame(data) {
  const view = new DataView(data.buffer || data);
  const eventCode = view.getUint32(4, false);

  const sessionIdLen = view.getUint32(8, false);
  const sessionIdBytes = new Uint8Array(data.buffer || data, 12, sessionIdLen);
  const sessionId = new TextDecoder().decode(sessionIdBytes);

  const payloadOffset = 12 + sessionIdLen;
  const payloadLen = view.getUint32(payloadOffset, false);
  const payloadBytes = new Uint8Array(data.buffer || data, payloadOffset + 4, payloadLen);
  const payloadStr = new TextDecoder().decode(payloadBytes);

  let payload = null;
  try { payload = JSON.parse(payloadStr); } catch {}

  return { eventCode, sessionId, payload };
}

async function callPodcast(nlpTexts, audioConfig, port) {
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId']);

  if (!config.ttsAppId || !config.ttsAccessKey) {
    safePostMessage(port, { type: 'error', errorKey: 'podcast.noTtsConfig' });
    return;
  }

  const appId = config.ttsAppId;
  const accessKey = config.ttsAccessKey;
  const resourceId = config.ttsResourceId || 'seed_tts';

  const sessionId = 'podcast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  const PODCAST_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';

  // Use declarativeNetRequest to inject auth headers into the WebSocket upgrade request
  // (browser WebSocket API cannot set custom HTTP headers)
  const dnrRuleId = 9000 + Math.floor(Math.random() * 999);
  let ws = null;

  try {
    // Add DNR rule to inject auth headers
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: dnrRuleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'X-Api-App-Id', operation: 'set', value: appId },
            { header: 'X-Api-Access-Key', operation: 'set', value: accessKey },
            { header: 'X-Api-Resource-Id', operation: 'set', value: 'volc.service_type.10050' },
            { header: 'X-Api-App-Key', operation: 'set', value: 'aGjiRDfUWi' },
          ]
        },
        condition: {
          urlFilter: '||openspeech.bytedance.com/api/v3/sami/podcasttts',
          resourceTypes: ['websocket']
        }
      }],
      removeRuleIds: [dnrRuleId]
    });

    ws = new WebSocket(PODCAST_WS_URL);
    ws.binaryType = 'arraybuffer';

    let resolved = false;

    const cleanup = () => {
      // Remove DNR rule after WebSocket is done
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [dnrRuleId]
      }).catch(() => {});
    };

    ws.addEventListener('open', () => {
      const startPayload = {
        action: 3,
        nlp_texts: nlpTexts,
        audio_config: {
          format: audioConfig?.format || 'mp3',
          sample_rate: audioConfig?.sample_rate || 24000,
          speech_rate: audioConfig?.speech_rate || 0
        },
        speaker_info: {
          random_order: true
        }
      };

      ws.send(encodePodcastFrame(150, sessionId, startPayload));
    });

    ws.addEventListener('message', (event) => {
      const frame = decodePodcastFrame(event.data);

      switch (frame.eventCode) {
        case 150: // SessionStarted
          break;

        case 360: // PodcastRoundStart
          safePostMessage(port, {
            type: 'round_start',
            idx: frame.payload?.idx,
            speaker: frame.payload?.speaker
          });
          break;

        case 361: // PodcastRoundResponse — audio data
          if (frame.payload?.data) {
            resolved = true;
            safePostMessage(port, { type: 'audio_chunk', data: frame.payload.data });
          } else if (frame.payload) {
            resolved = true;
            safePostMessage(port, { type: 'audio_chunk', data: frame.payload });
          }
          break;

        case 362: // PodcastRoundEnd
          safePostMessage(port, {
            type: 'round_end',
            audioDuration: frame.payload?.audio_duration,
            startTime: frame.payload?.start_time,
            endTime: frame.payload?.end_time
          });
          break;

        case 363: // PodcastEnd
          break;

        case 152: // SessionFinished
          resolved = true;
          safePostMessage(port, { type: 'done' });
          cleanup();
          ws.close();
          break;

        default:
          break;
      }
    });

    ws.addEventListener('error', () => {
      cleanup();
      if (!resolved) {
        safePostMessage(port, { type: 'error', errorKey: 'podcast.audioError' });
      }
    });

    ws.addEventListener('close', () => {
      cleanup();
      if (!resolved) {
        safePostMessage(port, { type: 'error', errorKey: 'podcast.audioError' });
      }
    });

  } catch (e) {
    // Clean up DNR rule on any error
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [dnrRuleId]
    }).catch(() => {});
    safePostMessage(port, { type: 'error', error: e.message });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ai-chat') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'chat') {
        await callOpenAI(msg.messages, port, { response_format: msg.response_format });
      }
    });
  } else if (port.name === 'tts') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'tts') {
        await callTTS(msg.text, port);
      }
    });
  } else if (port.name === 'tts-download') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'tts') {
        await callTTS(msg.text, port);
      }
    });
  } else if (port.name === 'suggest-questions') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'suggest') {
        await callSuggestQuestions(msg.messages, port);
      }
    });
  } else if (port.name === 'podcast-llm') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'generate') {
        const messages = [
          { role: 'user', content: `${msg.prompt}\n\n${msg.text}` }
        ];
        await callOpenAI(messages, port, {
          response_format: { type: 'json_object' }
        });
      }
    });
  } else if (port.name === 'podcast-audio') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'generate') {
        await callPodcast(msg.nlpTexts, msg.audioConfig, port);
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'selectionChanged' && !msg.forwarded) {
    chrome.runtime.sendMessage({
      action: 'selectionChanged',
      text: msg.text,
      tabId: sender.tab?.id,
      forwarded: true
    }).catch(() => {});
  }

  if (msg.action === 'fetchModels') {
    const baseUrl = msg.apiBase || 'https://api.deepseek.com';

    fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${msg.apiKey}`
      }
    })
    .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`);
      return res.json();
    })
    .then(data => {
      const models = (data.data || []).map(m => m.id);
      sendResponse({ success: true, models });
    })
    .catch(e => {
      sendResponse({ success: false, error: e.message });
    });

    return true;
  }

  if (msg.action === 'ocrParse') {
    chrome.storage.sync.get('ocrApiKey', (config) => {
      if (!config.ocrApiKey) {
        sendResponse({ success: false, errorKey: 'error.noOcrApiKey' });
        return;
      }

      fetch('https://open.bigmodel.cn/api/paas/v4/layout_parsing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ocrApiKey}`
        },
        body: JSON.stringify({
          model: 'glm-ocr',
          file: msg.file
        })
      })
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `OCR request failed (${res.status})`); });
        return res.json();
      })
      .then(data => {
        sendResponse({ success: true, data });
      })
      .catch(e => {
        sendResponse({ success: false, error: e.message });
      });
    });

    return true;
  }
});
