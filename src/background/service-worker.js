import { callOpenAI, callSuggestQuestions } from './sw-openai.js';
import { callTTS } from './sw-tts.js';
import { callPodcast } from './sw-podcast.js';
import { handleChartVision, handleChartAnalysis, handleChartScreenshot } from './sw-chart.js';
import { handleOcrParse } from './sw-ocr.js';

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

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
    return handleChartVision(msg, sendResponse);
  }

  if (msg.action === 'analyzeChart') {
    return handleChartAnalysis(msg, sendResponse);
  }

  if (msg.action === 'captureChartScreenshot') {
    return handleChartScreenshot(msg, sendResponse);
  }

  if (msg.action === 'ocrParse') {
    return handleOcrParse(msg, sendResponse);
  }
});
