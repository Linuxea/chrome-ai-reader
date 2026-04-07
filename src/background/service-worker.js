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
