import { vi, describe, it, expect, beforeEach } from 'vitest';

const store = { sync: { apiKey: 'sk-test', apiBase: 'https://api.test.com', modelName: 'test-model' } };

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store.sync[k] !== undefined) result[k] = store.sync[k]; });
        return Promise.resolve(result);
      },
    },
  },
  tabs: {
    query: vi.fn(async () => [{ id: 123 }]),
    sendMessage: vi.fn(async () => ({ success: true, data: { title: 'Test Page', textContent: 'body text' } })),
  },
});

vi.mock('../../src/background/sw-utils.js', () => ({ safePostMessage: vi.fn() }));

import { callAgent } from '../../src/background/sw-openai.js';
import { safePostMessage } from '../../src/background/sw-utils.js';

function createMockPort() {
  const disconnectListeners = new Set();
  return {
    postMessage: vi.fn(),
    onDisconnect: {
      addListener: vi.fn(fn => disconnectListeners.add(fn)),
      removeListener: vi.fn(),
    },
    _simulateDisconnect() { disconnectListeners.forEach(fn => fn()); },
  };
}

function sseResponse(events) {
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  const body = new ReadableStream({
    pull(ctrl) {
      if (i >= bytes.length) { ctrl.close(); return; }
      ctrl.enqueue(bytes.slice(i, i + 64));
      i += 64;
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('background/agent-loop', () => {
  let port;

  beforeEach(() => {
    vi.clearAllMocks();
    port = createMockPort();
    store.sync.apiKey = 'sk-test';
    store.sync.apiBase = 'https://api.test.com';
    store.sync.modelName = 'test-model';
  });

  it('runs the full loop: tool_call → execute → tool result roundtrip → done.messages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    let round = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      round++;
      if (round === 1) {
        // round 1: fragmented tool_call arguments must be reassembled by the SDK
        expect(body.tools.some(t => t.function?.name === 'read_page' || t.name === 'read_page')).toBe(true);
        return sseResponse([
          { choices: [{ delta: { reasoning_content: 'need the page' } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_page', arguments: '{"tab' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'Id":123}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]);
      }
      // round 2: the model already saw the tool result (tools are re-sent every step)
      expect(round).toBe(2);
      expect(body.messages.some(m => m.role === 'tool')).toBe(true);
      return sseResponse([
        { choices: [{ delta: { content: 'Page says: ' } }] },
        { choices: [{ delta: { content: 'body text' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]);
    });

    await callAgent([{ role: 'user', content: 'summarize the tab' }], port, ['read_page']);

    const posted = safePostMessage.mock.calls.map(c => c[1]);

    // Thinking forwarded
    expect(posted.some(m => m.type === 'thinking' && m.content === 'need the page')).toBe(true);
    // Tool call event with reassembled input
    expect(posted).toContainEqual({ type: 'tool_call', id: 'call_1', name: 'read_page', input: { tabId: 123 } });
    // Tool executed via chrome.tabs with the resolved tab id
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { action: 'extract' });
    // Tool result event carries the extracted page
    const toolResult = posted.find(m => m.type === 'tool_result');
    expect(toolResult.id).toBe('call_1');
    expect(toolResult.output).toContain('body text');
    // Final text streamed
    expect(posted.filter(m => m.type === 'chunk').map(m => m.content).join('')).toBe('Page says: body text');
    // done carries the authoritative exchange for persistence
    const done = posted.find(m => m.type === 'done');
    expect(done.messages).toEqual([
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', name: 'read_page', arguments: '{"tabId":123}' }] },
      { role: 'tool', tool_call_id: 'call_1', name: 'read_page', content: expect.stringContaining('body text') },
      { role: 'assistant', content: 'Page says: body text' },
    ]);
    // Two LLM round trips
    expect(fetchMock.mock.calls.length).toBe(2);
    fetchMock.mockRestore();
  });

  it('falls back to plain streaming when the enabled tool set is empty', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: 'plain answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]));

    await callAgent([{ role: 'user', content: 'hi' }], port, []);

    const posted = safePostMessage.mock.calls.map(c => c[1]);
    expect(posted).toContainEqual({ type: 'chunk', content: 'plain answer' });
    expect(posted.find(m => m.type === 'done').messages).toBeUndefined();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    fetchMock.mockRestore();
  });

  it('posts error.toolsNotSupported when the endpoint rejects function calling with a 400', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'tools is not supported for this model' } }), { status: 400 }),
    );

    await callAgent([{ role: 'user', content: 'hi' }], port, ['read_page']);

    expect(safePostMessage).toHaveBeenCalledWith(port, {
      type: 'error',
      error: 'tools is not supported for this model',
      errorKey: 'error.toolsNotSupported',
    });
    fetchMock.mockRestore();
  });

  it('posts config errors before any fetch', async () => {
    store.sync.apiKey = undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await callAgent([{ role: 'user', content: 'hi' }], port, ['read_page']);
    expect(safePostMessage).toHaveBeenCalledWith(port, { type: 'error', errorKey: 'error.noApiKey' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
