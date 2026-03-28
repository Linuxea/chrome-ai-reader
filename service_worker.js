// service_worker.js — 后台服务：调用 OpenAI API

// 点击扩展图标时打开侧边栏
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 流式调用 OpenAI API
async function callOpenAI(messages, port) {
  const { apiKey, apiBase } = await chrome.storage.sync.get(['apiKey', 'apiBase']);

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
        model: 'deepseek-chat',
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
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            port.postMessage({ type: 'chunk', content });
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
  if (port.name !== 'ai-chat') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'chat') {
      await callOpenAI(msg.messages, port);
    }
  });
});

// 中转选区变化消息给 side panel
// 注意：必须检查 !msg.forwarded，否则 service worker 会收到自己转发的消息导致无限循环
chrome.runtime.onMessage.addListener((msg, sender) => {
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
});
