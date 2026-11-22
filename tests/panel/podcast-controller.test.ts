import { vi, describe, it, expect, beforeEach } from 'vitest';

const { stopAllTTSMock } = vi.hoisted(() => ({ stopAllTTSMock: vi.fn() }));
vi.mock('@/panel/lib/tts-controller', () => ({ stopAllTTS: stopAllTTSMock }));

const { store, ports } = vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };
  function createStorageArea(storeKey: string) {
    return {
      get(keys: unknown, cb?: (r: unknown) => void) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store[storeKey][k as string] !== undefined) result[k as string] = store[storeKey][k as string]; });
        if (cb) { cb(result); return; }
        return Promise.resolve(result);
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.entries(items).forEach(([k, v]) => { store[storeKey][k] = v; });
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
      remove(keys: unknown, cb?: () => void) {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[storeKey][k as string]);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
    };
  }

  // Programmable port registry: every chrome.runtime.connect lands here and
  // tests push wire messages through `emit` / `fireDisconnect`.
  const ports: {
    name: string;
    postMessage: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    emit: (msg: unknown) => void;
    fireDisconnect: () => void;
  }[] = [];

  const connect = vi.fn((info?: { name?: string }) => {
    const name = info?.name ?? '';
    const postMessage = vi.fn();
    const disconnect = vi.fn();
    const messageListeners: ((m: unknown) => void)[] = [];
    const disconnectListeners: (() => void)[] = [];
    ports.push({
      name,
      postMessage,
      disconnect,
      emit: msg => messageListeners.forEach(cb => cb(msg)),
      fireDisconnect: () => disconnectListeners.forEach(cb => cb()),
    });
    return {
      name,
      postMessage,
      disconnect,
      onMessage: { addListener: (cb: (m: unknown) => void) => { messageListeners.push(cb); }, removeListener: vi.fn() },
      onDisconnect: { addListener: (cb: () => void) => { disconnectListeners.push(cb); }, removeListener: vi.fn() },
    } as unknown as chrome.runtime.Port;
  });

  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect,
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store, ports };
});

import { startPodcast, stopPodcast } from '@/panel/lib/podcast-controller';
import { stopPodcastForTTS, usePodcastStore } from '@/panel/stores/podcast-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import * as core from '@/panel/state';

// --- MSE / audio element fakes -------------------------------------------------

class FakeSourceBuffer {
  received: ArrayBuffer[] = [];
  updating = false;
  buffered = { length: 1, end: () => 100 };
  private listeners: Record<string, (() => void)[]> = {};
  addEventListener(ev: string, cb: () => void) { (this.listeners[ev] ??= []).push(cb); }
  appendBuffer(chunk: ArrayBuffer) { this.updating = true; this.received.push(chunk); }
  fire(ev: string) { this.updating = false; (this.listeners[ev] ?? []).forEach(cb => cb()); }
}

class FakeMediaSource {
  static instances: FakeMediaSource[] = [];
  readyState = 'open';
  sourceBuffers: FakeSourceBuffer[] = [];
  ended = false;
  private listeners: Record<string, (() => void)[]> = {};
  constructor() {
    FakeMediaSource.instances.push(this);
    void Promise.resolve().then(() => this.fire('sourceopen'));
  }
  addSourceBuffer() { const sb = new FakeSourceBuffer(); this.sourceBuffers.push(sb); return sb; }
  endOfStream() { this.ended = true; }
  addEventListener(ev: string, cb: () => void) { (this.listeners[ev] ??= []).push(cb); }
  fire(ev: string) { (this.listeners[ev] ?? []).forEach(cb => cb()); }
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  paused = true;
  ended = false;
  currentTime = 0;
  duration = NaN;
  src = '';
  private listeners: Record<string, (() => void)[]> = {};
  constructor() { FakeAudio.instances.push(this); }
  addEventListener(ev: string, cb: () => void) { (this.listeners[ev] ??= []).push(cb); }
  fire(ev: string) {
    if (ev === 'play') this.paused = false;
    if (ev === 'pause') this.paused = true;
    if (ev === 'ended') this.ended = true;
    (this.listeners[ev] ?? []).forEach(cb => cb());
  }
  play() { return Promise.resolve().then(() => { if (!this.ended) this.fire('play'); }); }
  pause() { if (!this.paused) this.fire('pause'); }
}

const portNamed = (name: string) => [...ports].reverse().find(p => p.name === name);
const portsNamed = (name: string) => ports.filter(p => p.name === name);

const SCRIPT = '```json\n{"rounds":[{"speaker":"A","text":"开场白"},{"speaker":"B","text":"接话"}]}```';

/** Drive the click flow through script generation into the audio phase. */
async function driveToAudioPhase(): Promise<void> {
  const p = startPodcast();
  await vi.waitFor(() => expect(portNamed('podcast-llm')).toBeTruthy());
  portNamed('podcast-llm')!.emit({ type: 'chunk', content: SCRIPT });
  portNamed('podcast-llm')!.emit({ type: 'done' });
  await p;
  await vi.waitFor(() => expect(portNamed('podcast-audio')).toBeTruthy());
}

/** Drive further: first chunk appended and status 'playing'. */
async function driveToPlaying(): Promise<void> {
  await driveToAudioPhase();
  portNamed('podcast-audio')!.emit({ type: 'audio_chunk', data: btoa('chunk-one') });
  await vi.waitFor(() => expect(usePodcastStore.getState().nowPlaying?.status).toBe('playing'));
  const sb = FakeMediaSource.instances[FakeMediaSource.instances.length - 1]!.sourceBuffers[0]!;
  await vi.waitFor(() => expect(sb.received).toHaveLength(1));
  sb.fire('updateend'); // completes chunk one → autoplay kicks in
  await vi.waitFor(() => expect(usePodcastStore.getState().playing).toBe(true));
}

describe('podcast-controller — click flow', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    ports.length = 0;
    FakeMediaSource.instances = [];
    FakeAudio.instances = [];
    stopAllTTSMock.mockClear();
    vi.stubGlobal('MediaSource', FakeMediaSource);
    vi.stubGlobal('Audio', FakeAudio);
    (URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:podcast-test';
    stopPodcast(); // reset module singletons between tests
    usePodcastStore.getState().clearNowPlaying();
    usePodcastStore.getState().resetPlayback();
    await useTabsStore.getState().init();
    useTabsStore.getState().setPageContent('一篇足够长的文章内容，用来当播客素材。');
    useTabsStore.getState().setSelectedText('');
  });

  it('script → parse → audio: full happy path, ordered bytes, flag lifecycle', async () => {
    const p = startPodcast();
    await vi.waitFor(() => expect(portNamed('podcast-llm')).toBeTruthy());

    // Starting a podcast claims the audio resource from TTS.
    expect(stopAllTTSMock).toHaveBeenCalled();
    // The request carries the zh podcast system prompt + page text.
    expect(portNamed('podcast-llm')!.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'generate',
      text: '一篇足够长的文章内容，用来当播客素材。',
    }));

    expect(usePodcastStore.getState().nowPlaying).toMatchObject({
      originTabId: 42,
      status: 'generating_script',
      sourcePreview: '',
    });

    portNamed('podcast-llm')!.emit({ type: 'chunk', content: SCRIPT });
    portNamed('podcast-llm')!.emit({ type: 'done' });
    await p;
    await vi.waitFor(() => expect(portNamed('podcast-audio')).toBeTruthy());

    const np = usePodcastStore.getState().nowPlaying;
    expect(np).toMatchObject({ status: 'generating_audio' });
    expect(np?.script.map(r => r.speakerLabel)).toEqual(['A', 'B']);
    expect(core.getStateForTab(42)?.isPodcastGenerating).toBe(true);

    // Audio phase: chunks in order into the MSE source buffer.
    const audioPort = portNamed('podcast-audio')!;
    expect(audioPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'generate',
      audioConfig: { format: 'mp3', sample_rate: 24000, speech_rate: 0 },
    }));

    audioPort.emit({ type: 'audio_chunk', data: btoa('chunk-one') });
    await vi.waitFor(() => expect(usePodcastStore.getState().nowPlaying?.status).toBe('playing'));
    expect(usePodcastStore.getState().hasAudio).toBe(true);

    const sb = FakeMediaSource.instances[FakeMediaSource.instances.length - 1]!.sourceBuffers[0]!;
    await vi.waitFor(() => expect(sb.received).toHaveLength(1));
    audioPort.emit({ type: 'audio_chunk', data: btoa('chunk-two') });
    sb.fire('updateend'); // chunk one completes → chunk two appends in order
    await vi.waitFor(() => expect(sb.received).toHaveLength(2));
    expect(new TextDecoder().decode(new Uint8Array(sb.received[0]!))).toBe('chunk-one');
    expect(new TextDecoder().decode(new Uint8Array(sb.received[1]!))).toBe('chunk-two');

    // Round timings accumulate (explicit times when the wire carries them).
    audioPort.emit({ type: 'round_end', audioDuration: 4 });
    audioPort.emit({ type: 'round_end', audioDuration: 5, startTime: 4, endTime: 9 });
    expect(usePodcastStore.getState().roundTimings).toEqual([
      { startTime: 0, endTime: 4 },
      { startTime: 4, endTime: 9 },
    ]);

    // Synthesis done → the origin tab's flag frees up while audio still plays.
    audioPort.emit({ type: 'done' });
    expect(core.getStateForTab(42)?.isPodcastGenerating).toBe(false);
    expect(usePodcastStore.getState().nowPlaying?.status).toBe('playing');

    // 'ended' flips the session to done.
    FakeAudio.instances[FakeAudio.instances.length - 1]!.fire('ended');
    expect(usePodcastStore.getState().nowPlaying?.status).toBe('done');
    expect(usePodcastStore.getState().playing).toBe(false);

    // Metadata port writes title + description into the session.
    const meta = portNamed('ai-chat')!;
    meta.emit({ type: 'chunk', content: '{"title":"节目名","description":"一期节目"}' });
    meta.emit({ type: 'done' });
    await vi.waitFor(() => expect(usePodcastStore.getState().nowPlaying?.title).toBe('节目名'));
    expect(usePodcastStore.getState().nowPlaying?.description).toBe('一期节目');
  });

  it('uses the selection as source material when present', async () => {
    useTabsStore.getState().setSelectedText('用户选中的一段文字，足够生成播客。');
    const p = startPodcast();
    await vi.waitFor(() => expect(portNamed('podcast-llm')).toBeTruthy());
    expect(portNamed('podcast-llm')!.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: '用户选中的一段文字，足够生成播客。',
    }));
    expect(usePodcastStore.getState().nowPlaying?.sourcePreview).toContain('用户选中的一段文字');
    portNamed('podcast-llm')!.emit({ type: 'done' }); // empty script → parse error path
    await p;
    expect(usePodcastStore.getState().nowPlaying?.status).toBe('error');
  });

  it('bails with a toast (no ports) when there is no material', async () => {
    // Whitespace-only content: the pageContent cache stays hit, the flow
    // reaches the no-content guard without touching extraction.
    useTabsStore.getState().setPageContent('   ');
    await startPodcast();
    expect(ports.filter(p => p.name === 'podcast-llm')).toHaveLength(0);
    expect(usePodcastStore.getState().nowPlaying).toBeNull();
    expect(core.getStateForTab(42)?.isPodcastGenerating).toBe(false);
  });

  it('LLM wire error surfaces as error status and resets the flag', async () => {
    const p = startPodcast();
    await vi.waitFor(() => expect(portNamed('podcast-llm')).toBeTruthy());
    portNamed('podcast-llm')!.emit({ type: 'error', error: 'boom' });
    await p;
    expect(usePodcastStore.getState().nowPlaying).toMatchObject({ status: 'error', statusText: 'boom' });
    expect(core.getStateForTab(42)?.isPodcastGenerating).toBe(false);
  });

  it('script port dying mid-stream salvages a parseable partial script', async () => {
    const p = startPodcast();
    await vi.waitFor(() => expect(portNamed('podcast-llm')).toBeTruthy());
    portNamed('podcast-llm')!.emit({ type: 'chunk', content: SCRIPT });
    portNamed('podcast-llm')!.fireDisconnect();
    await p;
    await vi.waitFor(() => expect(portNamed('podcast-audio')).toBeTruthy());
    expect(usePodcastStore.getState().nowPlaying?.status).toBe('generating_audio');
    expect(usePodcastStore.getState().nowPlaying?.script).toHaveLength(2);
  });

  it('a second startPodcast while generating is ignored', async () => {
    const p1 = startPodcast();
    const p2 = startPodcast(); // guard: the flag is already up
    await vi.waitFor(() => expect(portNamed('podcast-llm')).toBeTruthy());
    portNamed('podcast-llm')!.emit({ type: 'done' }); // empty script → error path
    await p1;
    await p2;
    expect(portsNamed('podcast-llm')).toHaveLength(1);
  });
});

describe('podcast-controller — TTS mutual exclusion', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    ports.length = 0;
    FakeMediaSource.instances = [];
    FakeAudio.instances = [];
    stopAllTTSMock.mockClear();
    vi.stubGlobal('MediaSource', FakeMediaSource);
    vi.stubGlobal('Audio', FakeAudio);
    (URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:podcast-test';
    stopPodcast();
    usePodcastStore.getState().clearNowPlaying();
    usePodcastStore.getState().resetPlayback();
    await useTabsStore.getState().init();
    useTabsStore.getState().setPageContent('一篇足够长的文章内容，用来当播客素材。');
    useTabsStore.getState().setSelectedText('');
  });

  it('stop signal while GENERATING cancels the entire session', async () => {
    const p = startPodcast();
    await vi.waitFor(() => expect(portNamed('podcast-llm')).toBeTruthy());
    stopPodcastForTTS();
    await p; // resolves through the cancellation path, not the port
    expect(usePodcastStore.getState().nowPlaying).toBeNull();
    expect(core.getStateForTab(42)?.isPodcastGenerating).toBe(false);
    expect(portNamed('podcast-llm')!.disconnect).toHaveBeenCalled();
  });

  it('stop signal while PLAYING stops like it ended — buffers kept for replay/download', async () => {
    await driveToPlaying();
    stopPodcastForTTS();
    const s = usePodcastStore.getState();
    expect(s.nowPlaying?.status).toBe('done');
    expect(s.playing).toBe(false);
    expect(s.hasAudio).toBe(true); // replay + download remain available
    expect(s.nowPlaying).not.toBeNull(); // the session itself survives
  });

  it('stopPodcast() tears everything down (card close)', async () => {
    await driveToPlaying();
    stopPodcast();
    const s = usePodcastStore.getState();
    expect(s.nowPlaying).toBeNull();
    expect(s.playing).toBe(false);
    expect(s.hasAudio).toBe(false);
    expect(core.getStateForTab(42)?.isPodcastGenerating).toBe(false);
    expect(portNamed('podcast-audio')!.disconnect).toHaveBeenCalled();
  });
});
