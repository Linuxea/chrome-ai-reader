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

// --- Podcast Audio (via local proxy) ---
//
// Browser WebSocket API cannot set custom HTTP headers.
// Volcengine Podcast API requires auth headers on the WebSocket handshake.
// Solution: A local Node.js proxy handles the WebSocket with proper headers,
// and streams audio back to this service worker via SSE over HTTP.
//
// Proxy: cd proxy && npm start → http://localhost:3456

const PODCAST_PROXY_URL = 'http://localhost:3456';

async function callPodcast(nlpTexts, audioConfig, port) {
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

  if (msg.action === 'analyzeChartVision') {
    const { apiKey, messages } = msg;
    if (!apiKey) {
      sendResponse({ success: false, error: 'No API Key' });
      return;
    }

    fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'glm-4v-flash',
        messages,
        temperature: 0.3
      })
    })
    .then(res => {
      if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `API request failed (${res.status})`); });
      return res.json();
    })
    .then(data => {
      const content = data.choices?.[0]?.message?.content || '';
      sendResponse({ success: true, content });
    })
    .catch(e => {
      sendResponse({ success: false, error: e.message });
    });

    return true;
  }

  if (msg.action === 'analyzeChart') {
    const { apiKey, apiBase, modelName } = msg;
    if (!apiKey) {
      sendResponse({ success: false, error: 'No API Key' });
      return;
    }
    const baseUrl = apiBase || 'https://api.deepseek.com';

    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName || 'deepseek-chat',
        messages: msg.messages,
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    })
    .then(res => {
      if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `API request failed (${res.status})`); });
      return res.json();
    })
    .then(data => {
      const content = data.choices?.[0]?.message?.content || '';
      sendResponse({ success: true, content });
    })
    .catch(e => {
      sendResponse({ success: false, error: e.message });
    });

    return true;
  }

  if (msg.action === 'captureChartScreenshot') {
    const { scrollX, scrollY, pageX, pageY, pageW, pageH, devicePixelRatio } = msg;
    const dpr = devicePixelRatio || 1;
    console.log('[AI Reader SW] captureChartScreenshot received:', { scrollX, scrollY, pageX, pageY, pageW, pageH, dpr });
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error('[AI Reader SW] captureVisibleTab failed:', chrome.runtime.lastError?.message);
        sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'capture failed' });
        return;
      }
      console.log('[AI Reader SW] captureVisibleTab ok, dataUrl length:', dataUrl.length);
      try {
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        const sx = Math.max(0, (pageX - scrollX) * dpr);
        const sy = Math.max(0, (pageY - scrollY) * dpr);
        const sw = pageW * dpr;
        const sh = pageH * dpr;
        console.log('[AI Reader SW] crop params:', { sx, sy, sw, sh, bmpW: bmp.width, bmpH: bmp.height });
        const c = new OffscreenCanvas(Math.round(sw), Math.round(sh));
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, Math.round(sw), Math.round(sh));
        const outBlob = await c.convertToBlob({ type: 'image/png' });
        const buffer = await outBlob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
        }
        const base64 = btoa(binary);
        console.log('[AI Reader SW] screenshot crop ok, base64 length:', base64.length);
        sendResponse({ success: true, dataUri: `data:image/png;base64,${base64}` });
      } catch (e) {
        console.error('[AI Reader SW] screenshot crop failed:', e.message);
        sendResponse({ success: false, error: 'screenshot crop failed: ' + e.message });
      }
    });
    return true;
  }

  if (msg.action === 'ocrParse') {
    chrome.storage.sync.get('ocrApiKey', (config) => {
      console.log('[OCR] Received ocrParse, has key:', !!config.ocrApiKey, 'file length:', msg.file?.length);
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
        console.log('[OCR] API response status:', res.status);
        if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `OCR request failed (${res.status})`); });
        return res.json();
      })
      .then(data => {
        console.log('[OCR] Success');
        sendResponse({ success: true, data });
      })
      .catch(e => {
        console.error('[OCR] Error:', e.message);
        sendResponse({ success: false, error: e.message });
      });
    });

    return true;
  }
});
