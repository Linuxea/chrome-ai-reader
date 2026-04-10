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
// Based on official Volcengine SDK: protocols.ts + podcasts.ts
//
// Protocol: 4-byte header + optional fields + payload
// Header byte layout:
//   [0] = (version << 4) | headerSize    — version=1, headerSize=1(4bytes) = 0x11
//   [1] = (msgType << 4) | flag           — FullClientRequest=1, WithEvent=4 = 0x14
//   [2] = (serialization << 4) | compress — JSON=1, None=0 = 0x10
//   [3] = 0x00
//
// Connection flow:
//   1. StartConnection (event=1) → ConnectionStarted (event=50)
//   2. StartSession (event=100) → SessionStarted (event=150)
//   3. FinishSession (event=102)
//   4. Receive: PodcastRoundStart(360), PodcastRoundResponse(361), PodcastRoundEnd(362), PodcastEnd(363)
//   5. SessionFinished (event=152)
//   6. FinishConnection (event=2) → ConnectionFinished (event=52)

const MsgType = {
  FullClientRequest: 0b1,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  Error: 0b1111,
};

const MsgFlag = {
  NoSeq: 0,
  WithEvent: 0b100,
};

const PodcastEvent = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFinished: 52,
  StartSession: 100,
  FinishSession: 102,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  PodcastRoundStart: 360,
  PodcastRoundResponse: 361,
  PodcastRoundEnd: 362,
  PodcastEnd: 363,
};

function buildFrame(eventType, sessionId, payloadObj) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));

  // Calculate total size
  const hasEvent = true;
  const hasSessionId = eventType !== PodcastEvent.StartConnection &&
                       eventType !== PodcastEvent.FinishConnection &&
                       eventType !== PodcastEvent.ConnectionStarted;
  const sessionIdBytes = sessionId ? new TextEncoder().encode(sessionId) : new Uint8Array(0);

  let totalSize = 4; // header
  if (hasEvent) totalSize += 4; // event code
  if (hasSessionId) totalSize += 4 + sessionIdBytes.length; // session id len + session id
  totalSize += 4 + payloadBytes.length; // payload len + payload

  const frame = new Uint8Array(totalSize);
  let offset = 0;

  // Header: version=1, headerSize=1, type=FullClientRequest, flag=WithEvent, JSON, no compress
  frame[offset++] = 0x11; // (1 << 4) | 1
  frame[offset++] = 0x14; // (FullClientRequest << 4) | WithEvent
  frame[offset++] = 0x10; // (JSON << 4) | None
  frame[offset++] = 0x00;

  // Event code (big-endian int32)
  const dv = new DataView(frame.buffer, offset, 4);
  dv.setInt32(0, eventType, false);
  offset += 4;

  // Session ID (if applicable)
  if (hasSessionId) {
    const sidLen = new DataView(frame.buffer, offset, 4);
    sidLen.setUint32(0, sessionIdBytes.length, false);
    offset += 4;
    frame.set(sessionIdBytes, offset);
    offset += sessionIdBytes.length;
  }

  // Payload
  const payLen = new DataView(frame.buffer, offset, 4);
  payLen.setUint32(0, payloadBytes.length, false);
  offset += 4;
  frame.set(payloadBytes, offset);

  return frame;
}

function parseFrame(data) {
  const arr = new Uint8Array(data);
  if (arr.length < 4) return null;

  const msgType = (arr[1] >> 4) & 0xF;
  const flag = arr[1] & 0xF;
  let offset = 4; // skip header

  let eventCode = null;
  let sessionId = '';
  let errorCode = null;
  let payload = null;

  if (msgType === MsgType.Error) {
    // Error: header + errorCode(4) + payload
    if (offset + 4 <= arr.length) {
      errorCode = new DataView(arr.buffer, arr.byteOffset + offset, 4).getUint32(0, false);
      offset += 4;
    }
  }

  if (flag === MsgFlag.WithEvent) {
    // Read event code
    if (offset + 4 <= arr.length) {
      eventCode = new DataView(arr.buffer, arr.byteOffset + offset, 4).getInt32(0, false);
      offset += 4;
    }
    // Read session ID (skip for connection events)
    if (eventCode !== PodcastEvent.StartConnection &&
        eventCode !== PodcastEvent.FinishConnection &&
        eventCode !== PodcastEvent.ConnectionStarted &&
        eventCode !== PodcastEvent.ConnectionFinished) {
      if (offset + 4 <= arr.length) {
        const sidLen = new DataView(arr.buffer, arr.byteOffset + offset, 4).getUint32(0, false);
        offset += 4;
        if (sidLen > 0 && offset + sidLen <= arr.length) {
          sessionId = new TextDecoder().decode(arr.slice(offset, offset + sidLen));
          offset += sidLen;
        }
      }
    }
  }

  // Read payload
  if (offset + 4 <= arr.length) {
    const payLen = new DataView(arr.buffer, arr.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
    if (payLen > 0 && offset + payLen <= arr.length) {
      const payloadBytes = arr.slice(offset, offset + payLen);
      if (msgType === MsgType.AudioOnlyServer) {
        // Audio data is raw binary — keep as Uint8Array
        payload = payloadBytes;
      } else {
        // JSON payload
        try {
          payload = JSON.parse(new TextDecoder().decode(payloadBytes));
        } catch {
          payload = payloadBytes;
        }
      }
    }
  }

  return { msgType, eventCode, sessionId, errorCode, payload };
}

async function callPodcast(nlpTexts, audioConfig, port) {
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId']);

  if (!config.ttsAppId || !config.ttsAccessKey) {
    safePostMessage(port, { type: 'error', errorKey: 'podcast.noTtsConfig' });
    return;
  }

  const appId = config.ttsAppId;
  const accessKey = config.ttsAccessKey;
  const resourceId = config.ttsResourceId || 'volc.service_type.10050';
  const connectId = crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

  const PODCAST_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';

  // Use declarativeNetRequest to inject auth headers into the WebSocket upgrade request
  const dnrRuleId = 9000 + Math.floor(Math.random() * 999);

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
            { header: 'X-Api-Resource-Id', operation: 'set', value: resourceId },
            { header: 'X-Api-App-Key', operation: 'set', value: 'aGjiRDfUWi' },
            { header: 'X-Api-Connect-Id', operation: 'set', value: connectId },
          ]
        },
        condition: {
          urlFilter: '||openspeech.bytedance.com/api/v3/sami/podcasttts',
          resourceTypes: ['websocket']
        }
      }],
      removeRuleIds: [dnrRuleId]
    });

    const ws = new WebSocket(PODCAST_WS_URL);
    ws.binaryType = 'arraybuffer';

    let resolved = false;

    const cleanup = () => {
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [dnrRuleId]
      }).catch(() => {});
    };

    // Promise-based message receiving
    const messageQueue = [];
    const messageWaiters = [];

    ws.addEventListener('message', (event) => {
      const frame = parseFrame(event.data);
      if (!frame) return;

      if (messageWaiters.length > 0) {
        const waiter = messageWaiters.shift();
        waiter(frame);
      } else {
        messageQueue.push(frame);
      }
    });

    function waitForMessage(timeout = 30000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), timeout);
        if (messageQueue.length > 0) {
          clearTimeout(timer);
          resolve(messageQueue.shift());
          return;
        }
        messageWaiters.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      });
    }

    function waitForEvent(eventCode, timeout = 30000) {
      return new Promise(async (resolve, reject) => {
        try {
          while (true) {
            const frame = await waitForMessage(timeout);
            if (frame.msgType === MsgType.Error) {
              const errMsg = frame.payload instanceof Uint8Array
                ? new TextDecoder().decode(frame.payload)
                : JSON.stringify(frame.payload);
              reject(new Error(errMsg));
              return;
            }
            if (frame.eventCode === eventCode) {
              resolve(frame);
              return;
            }
            // Skip unexpected events and keep waiting
          }
        } catch (e) {
          reject(e);
        }
      });
    }

    // === Connection flow (matching official SDK) ===

    // Wait for WebSocket open
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    // Step 1: StartConnection (event=1)
    ws.send(buildFrame(PodcastEvent.StartConnection, '', {}));
    await waitForEvent(PodcastEvent.ConnectionStarted);

    // Step 2: StartSession (event=100) with podcast parameters
    const sessionId = connectId; // reuse as session ID
    const sessionPayload = {
      input_id: 'chrome_ext_podcast',
      action: 3,
      nlp_texts: nlpTexts,
      use_head_music: false,
      use_tail_music: false,
      speaker_info: { random_order: true },
      audio_config: {
        format: audioConfig?.format || 'mp3',
        sample_rate: audioConfig?.sample_rate || 24000,
        speech_rate: audioConfig?.speech_rate || 0,
      },
    };

    ws.send(buildFrame(PodcastEvent.StartSession, sessionId, sessionPayload));
    await waitForEvent(PodcastEvent.SessionStarted);

    // Step 3: FinishSession (event=102) — signals we're done sending
    ws.send(buildFrame(PodcastEvent.FinishSession, sessionId, {}));

    // Step 4: Receive streaming data
    while (true) {
      const frame = await waitForMessage(120000); // 2 min timeout for long podcasts

      if (frame.msgType === MsgType.Error) {
        const errMsg = frame.payload instanceof Uint8Array
          ? new TextDecoder().decode(frame.payload)
          : (frame.payload?.message || JSON.stringify(frame.payload));
        safePostMessage(port, { type: 'error', error: errMsg });
        cleanup();
        return;
      }

      if (frame.msgType === MsgType.AudioOnlyServer &&
          frame.eventCode === PodcastEvent.PodcastRoundResponse) {
        // Audio data — raw binary payload, convert to base64
        resolved = true;
        const audioBytes = frame.payload instanceof Uint8Array ? frame.payload : new Uint8Array(0);
        let binary = '';
        for (let i = 0; i < audioBytes.length; i++) {
          binary += String.fromCharCode(audioBytes[i]);
        }
        safePostMessage(port, { type: 'audio_chunk', data: btoa(binary) });
      } else if (frame.eventCode === PodcastEvent.PodcastRoundStart) {
        safePostMessage(port, {
          type: 'round_start',
          idx: frame.payload?.round_id,
          speaker: frame.payload?.speaker,
        });
      } else if (frame.eventCode === PodcastEvent.PodcastRoundEnd) {
        safePostMessage(port, {
          type: 'round_end',
          audioDuration: frame.payload?.audio_duration,
          startTime: frame.payload?.start_time,
          endTime: frame.payload?.end_time,
        });
      } else if (frame.eventCode === PodcastEvent.PodcastEnd) {
        // Optional summary
      } else if (frame.eventCode === PodcastEvent.SessionFinished) {
        // Done!
        safePostMessage(port, { type: 'done' });
        // Step 5: FinishConnection
        ws.send(buildFrame(PodcastEvent.FinishConnection, '', {}));
        break;
      }
    }

    cleanup();
    ws.close();
  } catch (e) {
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
