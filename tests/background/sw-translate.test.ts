import { vi, describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../src/background/chat-runner', () => ({ completeChat: vi.fn() }));
vi.mock('../../src/platform/settings', () => ({ readSettings: vi.fn(async () => ({ language: 'zh' })) }));

import { translateBatch, parseTranslations } from '../../src/background/sw-translate';
import { completeChat } from '../../src/background/chat-runner';
import { dbClear } from '../../src/shared/db';

beforeEach(async () => {
  vi.clearAllMocks();
  await dbClear('translations');
});

describe('background/sw-translate', () => {
  it('parses translations from fenced / prose-wrapped JSON and pads missing ones', () => {
    expect(parseTranslations('Sure:\n```json\n{"translations": ["一", "二"]}\n```', 3)).toEqual(['一', '二', '']);
    expect(parseTranslations('not json at all', 2)).toEqual(['', '']);
  });

  it('translates only uncached paragraphs, in one request, and caches the results', async () => {
    vi.mocked(completeChat).mockResolvedValueOnce({ text: '{"translations":["你好","世界"]}', finishReason: 'stop' });
    expect(await translateBatch(['Hello', 'World'], 'zh')).toEqual(['你好', '世界']);
    expect(JSON.parse((vi.mocked(completeChat).mock.calls[0][0].messages[1].content) as string)).toEqual({ paragraphs: ['Hello', 'World'] });
    expect(vi.mocked(completeChat).mock.calls[0][0]).toMatchObject({ purpose: 'light', jsonMode: true });

    vi.mocked(completeChat).mockResolvedValueOnce({ text: '{"translations":["新的"]}', finishReason: 'stop' });
    expect(await translateBatch(['World', 'New'], 'zh')).toEqual(['世界', '新的']);
    expect(JSON.parse((vi.mocked(completeChat).mock.calls[1][0].messages[1].content) as string)).toEqual({ paragraphs: ['New'] });

    expect(await translateBatch(['Hello'], 'zh')).toEqual(['你好']);
    expect(completeChat).toHaveBeenCalledTimes(2); // fully cached — no request
  });
});
