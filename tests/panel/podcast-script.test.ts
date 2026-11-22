import { vi, describe, it, expect } from 'vitest';

// state.ts (imported transitively by the controller) touches chrome.tabs at
// module load; tts-controller is mocked to keep the TTS player chain out.
vi.mock('@/panel/lib/tts-controller', () => ({ stopAllTTS: vi.fn() }));
const { store } = vi.hoisted(() => {
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
      connect: vi.fn(() => ({
        name: 'ai-chat',
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store };
});

import {
  parsePodcastScript,
  validateAndMapRounds,
  extractRoundsFallback,
  extractPodcastTitle,
  roundIndexAt,
  base64ToBytes,
} from '@/panel/lib/podcast-controller';

const MALE = 'zh_male_dayixiansheng_v2_saturn_bigtts';
const FEMALE = 'zh_female_mizaitongxue_v2_saturn_bigtts';

describe('podcast script parsing', () => {
  it('parses a plain JSON script and maps speakers', () => {
    const rounds = parsePodcastScript('{"rounds":[{"speaker":"A","text":"第一句"},{"speaker":"B","text":"第二句"}]}');
    expect(rounds).toEqual([
      { speaker: MALE, text: '第一句', speakerLabel: 'A' },
      { speaker: FEMALE, text: '第二句', speakerLabel: 'B' },
    ]);
  });

  it('strips a markdown code fence before parsing', () => {
    const script = '```json\n{"rounds":[{"speaker":"A","text":"内容"}]}\n```';
    expect(parsePodcastScript(script)).toEqual([
      { speaker: MALE, text: '内容', speakerLabel: 'A' },
    ]);
  });

  it('repairs trailing commas (repairLLMJson path)', () => {
    const broken = '{"rounds":[{"speaker":"A","text":"你好",},{"speaker":"B","text":"欢迎",},]}';
    const rounds = parsePodcastScript(broken);
    expect(rounds.map(r => r.speakerLabel)).toEqual(['A', 'B']);
  });

  it('falls back to the regex extractor when JSON is unparseable', () => {
    // Unterminated object/array — even the repaired parse fails, but both
    // speaker/text pairs are recoverable by scanning.
    const broken = '前置说明 {"rounds": [{"speaker":"A","text":"甲"},{"speaker":"B","text":"乙"';
    const rounds = parsePodcastScript(broken + '}');
    expect(rounds.map(r => [r.speakerLabel, r.text])).toEqual([['A', '甲'], ['B', '乙']]);
  });

  it('drops invalid rounds via the layered path (parse ok, validate fails, fallback keeps valid ones)', () => {
    const broken = '{"rounds":[{"speaker":"A"},{"speaker":"B","text":"好的"}]}';
    const rounds = parsePodcastScript(broken);
    expect(rounds).toEqual([{ speaker: FEMALE, text: '好的', speakerLabel: 'B' }]);
  });

  it('throws when no JSON is present at all', () => {
    expect(() => parsePodcastScript('完全没有 JSON 的回复')).toThrow('No JSON found in script');
  });

  it('throws when the rounds array is empty or unusable', () => {
    expect(() => parsePodcastScript('{"rounds":[]}')).toThrow();
    expect(() => parsePodcastScript('{"rounds":[{"text":"missing speaker"}]}')).toThrow();
  });

  it('validateAndMapRounds caps text at 280 chars and defaults unknown speakers', () => {
    const rounds = validateAndMapRounds({ rounds: [{ speaker: 'C', text: 'x'.repeat(400) }] });
    expect(rounds[0].speaker).toBe(FEMALE); // DEFAULT_SPEAKER
    expect(rounds[0].text).toHaveLength(280);
    // lowercase labels map through the uppercased lookup
    expect(validateAndMapRounds({ rounds: [{ speaker: 'a', text: 'hi' }] })[0].speaker).toBe(MALE);
  });

  it('extractRoundsFallback unescapes and skips empty texts', () => {
    const raw = '{"speaker":"A","text":"带\\n换行"},{"speaker":"B","text":""}';
    const rounds = extractRoundsFallback(raw);
    expect(rounds).toEqual([{ speaker: MALE, text: '带\n换行', speakerLabel: 'A' }]);
  });

  it('extractPodcastTitle builds a short filesystem-safe title', () => {
    const rounds = [
      { speaker: MALE, text: '今天我们来聊聊最新的 AI 阅读助手', speakerLabel: 'A' },
      { speaker: FEMALE, text: '是的，这个话题最近很火', speakerLabel: 'B' },
    ];
    const title = extractPodcastTitle(rounds);
    expect(title).not.toMatch(/[/\\:*?"<>|]/);
    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(extractPodcastTitle([])).toBe('');
  });
});

describe('roundIndexAt', () => {
  const timings = [
    { startTime: 0, endTime: 5 },
    { startTime: 5, endTime: 9 },
    { startTime: 9, endTime: 14 },
  ];

  it('finds the covering round', () => {
    expect(roundIndexAt(0, timings)).toBe(0);
    expect(roundIndexAt(4.9, timings)).toBe(0);
    expect(roundIndexAt(6, timings)).toBe(1);
  });

  it('past the last round pins to the final round; before/empty is -1', () => {
    expect(roundIndexAt(20, timings)).toBe(2);
    expect(roundIndexAt(-1, timings)).toBe(-1);
    expect(roundIndexAt(3, [])).toBe(-1);
  });
});

describe('base64ToBytes', () => {
  it('round-trips bytes', () => {
    const bytes = base64ToBytes(btoa('hello podcast'));
    expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode('hello podcast')));
  });
});
