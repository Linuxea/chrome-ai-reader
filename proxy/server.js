// server.js — Local proxy for Volcengine Podcast WebSocket API
//
// Problem: Browser WebSocket API cannot set custom HTTP headers.
// Volcengine Podcast API requires auth headers on the WebSocket handshake.
// Solution: This Node.js proxy accepts HTTP POST, opens WebSocket with
// proper headers, and streams audio back via SSE.
//
// Usage: npm start → listens on http://localhost:3456

const http = require('http');
const { WebSocket } = require('ws');

const PORT = process.env.PORT || 3456;

// --- Binary Protocol Constants (from Volcengine SDK) ---

const MsgType = {
  FullClientRequest: 0b1,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  Error: 0b1111,
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

// --- Binary Frame Encoding/Decoding ---

function buildFrame(eventType, sessionId, payloadObj) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const hasSessionId = eventType !== PodcastEvent.StartConnection &&
                       eventType !== PodcastEvent.FinishConnection &&
                       eventType !== PodcastEvent.ConnectionStarted;
  const sessionIdBytes = sessionId ? new TextEncoder().encode(sessionId) : new Uint8Array(0);

  let totalSize = 4; // header
  totalSize += 4; // event code
  if (hasSessionId) totalSize += 4 + sessionIdBytes.length;
  totalSize += 4 + payloadBytes.length;

  const frame = new Uint8Array(totalSize);
  let offset = 0;

  frame[offset++] = 0x11;
  frame[offset++] = 0x14;
  frame[offset++] = 0x10;
  frame[offset++] = 0x00;

  const dv = new DataView(frame.buffer, offset, 4);
  dv.setInt32(0, eventType, false);
  offset += 4;

  if (hasSessionId) {
    const sidLen = new DataView(frame.buffer, offset, 4);
    sidLen.setUint32(0, sessionIdBytes.length, false);
    offset += 4;
    frame.set(sessionIdBytes, offset);
    offset += sessionIdBytes.length;
  }

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
  let offset = 4;

  let eventCode = null;
  let sessionId = '';
  let errorCode = null;
  let payload = null;

  if (msgType === MsgType.Error) {
    if (offset + 4 <= arr.length) {
      errorCode = new DataView(arr.buffer, arr.byteOffset + offset, 4).getUint32(0, false);
      offset += 4;
    }
  }

  if (flag === 0b100) { // WithEvent
    if (offset + 4 <= arr.length) {
      eventCode = new DataView(arr.buffer, arr.byteOffset + offset, 4).getInt32(0, false);
      offset += 4;
    }
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

  if (offset + 4 <= arr.length) {
    const payLen = new DataView(arr.buffer, arr.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
    if (payLen > 0 && offset + payLen <= arr.length) {
      const payloadBytes = arr.slice(offset, offset + payLen);
      if (msgType === MsgType.AudioOnlyServer) {
        payload = payloadBytes;
      } else {
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

// --- WebSocket message queue ---

function createMessageQueue(ws) {
  const queue = [];
  const waiters = [];

  ws.on('message', (data) => {
    const frame = parseFrame(data);
    if (!frame) return;
    if (waiters.length > 0) {
      waiters.shift()(frame);
    } else {
      queue.push(frame);
    }
  });

  function waitForMessage(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), timeout);
      if (queue.length > 0) {
        clearTimeout(timer);
        resolve(queue.shift());
        return;
      }
      waiters.push((frame) => {
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
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  return { waitForMessage, waitForEvent };
}

// --- SSE helper ---

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// --- Podcast handler ---

async function handlePodcast(params, res) {
  const { nlpTexts, audioConfig, appId, accessKey, resourceId, connectId } = params;
  const sessionId = connectId;

  console.log(`[Podcast] Starting: ${nlpTexts.length} rounds, id: ${connectId}`);

  const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/sami/podcasttts', {
    headers: {
      'X-Api-App-Id': appId,
      'X-Api-Access-Key': accessKey,
      'X-Api-Resource-Id': resourceId || 'volc.service_type.10050',
      'X-Api-App-Key': 'aGjiRDfUWi',
      'X-Api-Connect-Id': connectId,
    },
  });

  const { waitForMessage, waitForEvent } = createMessageQueue(ws);

  // Wait for WebSocket open
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('[Podcast] WebSocket opened');
      resolve();
    });
    ws.on('error', (err) => {
      console.error('[Podcast] WebSocket error:', err.message);
      reject(new Error('WebSocket connection failed: ' + err.message));
    });
  });

  try {
    // Step 1: StartConnection
    ws.send(buildFrame(PodcastEvent.StartConnection, '', {}));
    await waitForEvent(PodcastEvent.ConnectionStarted);
    console.log('[Podcast] ConnectionStarted');

    // Step 2: StartSession
    ws.send(buildFrame(PodcastEvent.StartSession, sessionId, {
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
    }));
    await waitForEvent(PodcastEvent.SessionStarted);
    console.log('[Podcast] SessionStarted');

    // Step 3: FinishSession
    ws.send(buildFrame(PodcastEvent.FinishSession, sessionId, {}));

    // Step 4: Receive streaming data
    let audioChunks = 0;
    while (true) {
      const frame = await waitForMessage(120000);

      if (frame.msgType === MsgType.Error) {
        const errMsg = frame.payload instanceof Uint8Array
          ? new TextDecoder().decode(frame.payload)
          : (frame.payload?.message || JSON.stringify(frame.payload));
        console.error('[Podcast] Protocol error:', errMsg);
        sendSSE(res, 'error', { error: errMsg });
        break;
      }

      if (frame.msgType === MsgType.AudioOnlyServer &&
          frame.eventCode === PodcastEvent.PodcastRoundResponse) {
        const audioBytes = frame.payload instanceof Uint8Array ? frame.payload : new Uint8Array(0);
        let binary = '';
        for (let i = 0; i < audioBytes.length; i++) {
          binary += String.fromCharCode(audioBytes[i]);
        }
        sendSSE(res, 'audio_chunk', { data: Buffer.from(audioBytes).toString('base64') });
        audioChunks++;
      } else if (frame.eventCode === PodcastEvent.PodcastRoundStart) {
        sendSSE(res, 'round_start', {
          idx: frame.payload?.round_id,
          speaker: frame.payload?.speaker,
        });
      } else if (frame.eventCode === PodcastEvent.PodcastRoundEnd) {
        sendSSE(res, 'round_end', {
          audioDuration: frame.payload?.audio_duration,
          startTime: frame.payload?.start_time,
          endTime: frame.payload?.end_time,
        });
      } else if (frame.eventCode === PodcastEvent.PodcastEnd) {
        // Optional summary — skip
      } else if (frame.eventCode === PodcastEvent.SessionFinished) {
        console.log(`[Podcast] SessionFinished, ${audioChunks} audio chunks sent`);
        sendSSE(res, 'done', {});
        try { ws.send(buildFrame(PodcastEvent.FinishConnection, '', {})); } catch {}
        break;
      }
    }
  } catch (e) {
    console.error('[Podcast] Error:', e.message);
    sendSSE(res, 'error', { error: e.message });
  }

  ws.close();
  res.end();
}

// --- HTTP Server ---

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/podcast') {
    // Read body
    let body = '';
    for await (const chunk of req) body += chunk;

    let params;
    try {
      params = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Validate required fields
    if (!params.appId || !params.accessKey || !params.nlpTexts) {
      res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing required fields: appId, accessKey, nlpTexts' }));
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      await handlePodcast(params, res);
    } catch (e) {
      sendSSE(res, 'error', { error: e.message });
      res.end();
    }
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[Podcast Proxy] Listening on http://localhost:${PORT}`);
  console.log(`[Podcast Proxy] POST /podcast — start podcast synthesis`);
  console.log(`[Podcast Proxy] GET  /health — health check`);
});
