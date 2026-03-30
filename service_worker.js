// service_worker.js — 后台服务：调用 OpenAI API

// 点击扩展图标时打开侧边栏
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 流式调用 OpenAI API
async function callOpenAI(messages, port) {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);

  if (!apiKey) {
    port.postMessage({ type: 'error', error: '请先在设置页面配置 API Key' });
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
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API 请求失败 (${response.status})`);
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
          port.postMessage({ type: 'done' });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            port.postMessage({ type: 'thinking', content: delta.reasoning_content });
          }
          if (delta?.content) {
            port.postMessage({ type: 'chunk', content: delta.content });
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    port.postMessage({ type: 'done' });
  } catch (e) {
    port.postMessage({ type: 'error', error: e.message });
  }
}

// 流式调用火山引擎 TTS API（SSE 格式）
async function callTTS(text, port) {
  console.log('[TTS SW] callTTS called, text length:', text.length);
  const config = await chrome.storage.sync.get(['ttsAppId', 'ttsAccessKey', 'ttsResourceId', 'ttsSpeaker']);
  console.log('[TTS SW] config loaded, has appId:', !!config.ttsAppId, 'has accessKey:', !!config.ttsAccessKey);

  if (!config.ttsAppId || !config.ttsAccessKey) {
    console.error('[TTS SW] missing config');
    port.postMessage({ type: 'error', error: '请先在设置页面配置 TTS 语音合成' });
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

    console.log('[TTS SW] API response status:', response.status);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[TTS SW] API error response:', errorText.slice(0, 500));
      throw new Error(`TTS 请求失败 (${response.status})${errorText ? ': ' + errorText.slice(0, 200) : ''}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedAudio = false;
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 事件以 \n\n 分隔
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
            port.postMessage({ type: 'error', error: parsed.message || `TTS 错误 (code: ${parsed.code})` });
            return;
          }

          if (eventType === '352' && parsed.data) {
            receivedAudio = true;
            console.log('[TTS SW] sending chunk, data length:', parsed.data.length);
            port.postMessage({ type: 'chunk', data: parsed.data });
          } else if (eventType === '153') {
            console.error('[TTS SW] SessionFailed:', parsed.message);
            port.postMessage({ type: 'error', error: parsed.message || 'TTS 合成失败' });
            return;
          } else if (eventType === '152' && receivedAudio) {
            console.log('[TTS SW] SessionFinish (done), total chunks sent');
            port.postMessage({ type: 'done' });
            return;
          } else {
            console.log('[TTS SW] unhandled event:', eventType, 'data:', eventData.slice(0, 100));
            // 只在已收到音频数据后才将 152 视为完成信号
            // （火山引擎可能先发 152 表示流开始，再发 352 音频数据，最后再发 152 表示结束）
            port.postMessage({ type: 'done' });
            return;
          }
        } catch {
          // 跳过无法解析的事件
        }
      }
    }

    // 流正常结束但未收到 152 事件
    port.postMessage({ type: 'done' });
  } catch (e) {
    try { port.postMessage({ type: 'error', error: e.message }); } catch {}
  }
}

// 生成推荐追问（流式）
async function callSuggestQuestions(messages, port) {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName']);

  if (!apiKey) {
    port.postMessage({ type: 'error', error: '未配置 API Key，无法生成推荐问题' });
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
      throw new Error(errorData.error?.message || `API 请求失败 (${response.status})`);
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
          port.postMessage({ type: 'done' });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            port.postMessage({ type: 'chunk', content: delta.content });
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    port.postMessage({ type: 'done' });
  } catch (e) {
    port.postMessage({ type: 'error', error: e.message });
  }
}

// 监听来自 side_panel 的长连接
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ai-chat') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'chat') {
        await callOpenAI(msg.messages, port);
      }
    });
  } else if (port.name === 'tts') {
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

// 消息处理：选区变化中转 + 模型列表请求
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'selectionChanged' && !msg.forwarded) {
    chrome.runtime.sendMessage({
      action: 'selectionChanged',
      text: msg.text,
      tabId: sender.tab?.id,
      forwarded: true
    }).catch(() => {
      // side panel 未打开时 sendMessage 会报错，静默忽略
    });
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
      if (!res.ok) throw new Error(`获取模型列表失败 (${res.status})`);
      return res.json();
    })
    .then(data => {
      const models = (data.data || []).map(m => m.id);
      sendResponse({ success: true, models });
    })
    .catch(e => {
      sendResponse({ success: false, error: e.message });
    });

    // 返回 true 表示异步发送 sendResponse
    return true;
  }

  // OCR 文字识别（智谱 GLM-OCR）
  if (msg.action === 'ocrParse') {
    chrome.storage.sync.get('ocrApiKey', (config) => {
      if (!config.ocrApiKey) {
        sendResponse({ success: false, error: '请先在设置页面配置 OCR API Key' });
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
        if (!res.ok) return res.json().then(d => { throw new Error(d.error?.message || `OCR 请求失败 (${res.status})`); });
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
