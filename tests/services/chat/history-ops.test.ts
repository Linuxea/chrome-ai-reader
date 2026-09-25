/**
 * Tests for side_panel/services/chat/history-ops.ts — centralized conversation
 * history operations that replaced three duplicated rollback blocks.
 *
 * Covers:
 * - rollbackTrailingUserMessage: pops trailing user turn (no-op on assistant/empty)
 * - truncateHistoryFromUserContent: finds matching user content and truncates tail
 * - appendMessage: pushes + persists
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/side_panel/state.js', () => ({
  persistForTab: vi.fn(),
}));

import {
  rollbackTrailingUserMessage,
  truncateHistoryFromUserContent,
  truncateHistoryFromId,
  appendMessage,
  stripImagesForPersistence,
} from '../../../src/side_panel/services/chat/history-ops';
import * as stateMock from '../../../src/side_panel/state.js';
import type { TabState, ChatMessage } from '../../../src/shared/types';

function makeTabState(history: ChatMessage[]): TabState {
  // Minimal TabState with just conversationHistory populated; other fields
  // are irrelevant to history-ops.
  return {
    pageContent: '',
    pageTitle: '',
    pageExcerpt: '',
    conversationHistory: history,
    currentChatId: null,
    selectedText: '',
    isGenerating: false,
    isPodcastGenerating: false,
    ocrRunning: 0,
    ocrResults: [],
    imageIndex: 0,
  };
}

describe('services/chat/history-ops', () => {
  const TAB_ID = 42;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // rollbackTrailingUserMessage
  // ==========================================================================
  describe('rollbackTrailingUserMessage', () => {
    it('removes the trailing user message and persists', () => {
      const ts = makeTabState([
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'q' },
      ]);

      const removed = rollbackTrailingUserMessage(ts, TAB_ID);

      expect(removed).toBe(true);
      expect(ts.conversationHistory).toEqual([{ role: 'assistant', content: 'hi' }]);
      expect(stateMock.persistForTab).toHaveBeenCalledWith(TAB_ID);
    });

    it('returns false and does NOT persist when last message is assistant', () => {
      const ts = makeTabState([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ]);

      const removed = rollbackTrailingUserMessage(ts, TAB_ID);

      expect(removed).toBe(false);
      expect(ts.conversationHistory).toHaveLength(2);
      expect(stateMock.persistForTab).not.toHaveBeenCalled();
    });

    it('returns false and does NOT persist when history is empty', () => {
      const ts = makeTabState([]);

      const removed = rollbackTrailingUserMessage(ts, TAB_ID);

      expect(removed).toBe(false);
      expect(stateMock.persistForTab).not.toHaveBeenCalled();
    });

    it('removes only the last message even if multiple user turns exist', () => {
      const ts = makeTabState([
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ]);

      rollbackTrailingUserMessage(ts, TAB_ID);

      expect(ts.conversationHistory).toEqual([
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ]);
    });
  });

  // ==========================================================================
  // truncateHistoryFromId
  // ==========================================================================
  describe('truncateHistoryFromId', () => {
    it('truncates from the message with that id — not a later one with the same text', () => {
      const ts = makeTabState([
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'a1' },
        { id: 'u2', role: 'user', content: 'hello' },
        { id: 'a2', role: 'assistant', content: 'a2' },
      ]);

      const idx = truncateHistoryFromId(ts, 'u1', TAB_ID);

      expect(idx).toBe(0);
      expect(ts.conversationHistory).toEqual([]);
    });

    it('leaves history unchanged when the id is unknown (e.g. already rolled back)', () => {
      const ts = makeTabState([{ id: 'u1', role: 'user', content: 'q' }]);
      expect(truncateHistoryFromId(ts, 'gone', TAB_ID)).toBe(-1);
      expect(ts.conversationHistory).toHaveLength(1);
    });
  });

  // ==========================================================================
  // truncateHistoryFromUserContent
  // ==========================================================================
  describe('truncateHistoryFromUserContent', () => {
    it('truncates from the LAST matching user content to the end', () => {
      const ts = makeTabState([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'a2' },
      ]);

      const idx = truncateHistoryFromUserContent(ts, 'hello', TAB_ID);

      // findLastIndex → index 2 is the last 'hello'; truncates [2..end]
      expect(idx).toBe(2);
      expect(ts.conversationHistory).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'a1' },
      ]);
      expect(stateMock.persistForTab).toHaveBeenCalledWith(TAB_ID);
    });

    it('returns -1 and does NOT persist when no user message matches', () => {
      const ts = makeTabState([
        { role: 'user', content: 'other' },
        { role: 'assistant', content: 'a' },
      ]);

      const idx = truncateHistoryFromUserContent(ts, 'hello', TAB_ID);

      expect(idx).toBe(-1);
      expect(ts.conversationHistory).toHaveLength(2);
      expect(stateMock.persistForTab).not.toHaveBeenCalled();
    });

    it('ignores assistant messages that happen to match the content', () => {
      const ts = makeTabState([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'q' }, // same content but assistant role
      ]);

      const idx = truncateHistoryFromUserContent(ts, 'q', TAB_ID);

      // Only the user turn at index 0 matches → truncates everything
      expect(idx).toBe(0);
      expect(ts.conversationHistory).toEqual([]);
    });

    it('handles empty history gracefully', () => {
      const ts = makeTabState([]);

      const idx = truncateHistoryFromUserContent(ts, 'hello', TAB_ID);

      expect(idx).toBe(-1);
      expect(stateMock.persistForTab).not.toHaveBeenCalled();
    });

    it('matches visual (array content) user message by its text parts', () => {
      const ts = makeTabState([
        { role: 'user', content: [
          { type: 'text', text: '分析这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ], hadImages: true },
        { role: 'assistant', content: '这是一个图表' },
      ]);

      const idx = truncateHistoryFromUserContent(ts, '分析这张图', TAB_ID);

      expect(idx).toBe(0);
      expect(ts.conversationHistory).toHaveLength(0);
      expect(stateMock.persistForTab).toHaveBeenCalledWith(TAB_ID);
    });

    it('does NOT match visual message when text parts differ from userContent', () => {
      const ts = makeTabState([
        { role: 'user', content: [
          { type: 'text', text: '不同的文字' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ] },
      ]);

      const idx = truncateHistoryFromUserContent(ts, '分析这张图', TAB_ID);

      expect(idx).toBe(-1);
      expect(ts.conversationHistory).toHaveLength(1);
    });
  });

  // ==========================================================================
  // appendMessage
  // ==========================================================================
  describe('appendMessage', () => {
    it('appends a message and persists', () => {
      const ts = makeTabState([{ role: 'user', content: 'q' }]);

      appendMessage(ts, { role: 'assistant', content: 'a' }, TAB_ID);

      expect(ts.conversationHistory).toEqual([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ]);
      expect(stateMock.persistForTab).toHaveBeenCalledWith(TAB_ID);
    });

    it('appends to empty history', () => {
      const ts = makeTabState([]);

      appendMessage(ts, { role: 'user', content: 'first' }, TAB_ID);

      expect(ts.conversationHistory).toEqual([{ role: 'user', content: 'first' }]);
    });
  });

  // ==========================================================================
  // stripImagesForPersistence
  // ==========================================================================
  describe('stripImagesForPersistence', () => {
    it('returns string-content messages unchanged', () => {
      const msg = { role: 'user' as const, content: 'hello' };
      expect(stripImagesForPersistence(msg)).toEqual(msg);
    });

    it('strips image_url blocks from array content, keeps text joined by newline', () => {
      const msg = {
        role: 'user' as const,
        content: [
          { type: 'text', text: '分析这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,def' } },
        ],
        hadImages: true,
      };
      const out = stripImagesForPersistence(msg);
      expect(typeof out.content).toBe('string');
      expect(out.content).toBe('分析这张图');
      expect(out.hadImages).toBe(true);
    });

    it('joins multiple text blocks with newline', () => {
      const msg = {
        role: 'user' as const,
        content: [
          { type: 'text', text: '第一句' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
          { type: 'text', text: '第二句' },
        ],
      };
      const out = stripImagesForPersistence(msg);
      expect(out.content).toBe('第一句\n第二句');
    });

    it('returns empty string content when array has no text blocks', () => {
      const msg = {
        role: 'user' as const,
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,only' } },
        ],
      };
      const out = stripImagesForPersistence(msg);
      expect(out.content).toBe('');
    });
  });

  // ==========================================================================
  // appendMessage — vision message persistence (memory keeps originals)
  // ==========================================================================
  describe('appendMessage — vision message persistence', () => {
    it('keeps image_url blocks in memory conversationHistory', () => {
      const ts = makeTabState([]);
      const visionMsg = {
        role: 'user' as const,
        content: [
          { type: 'text', text: '看图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,zzz' } },
        ],
        hadImages: true,
      };

      appendMessage(ts, visionMsg, TAB_ID);

      expect(ts.conversationHistory).toHaveLength(1);
      expect(Array.isArray(ts.conversationHistory[0].content)).toBe(true);
      expect(stateMock.persistForTab).toHaveBeenCalledWith(TAB_ID);
    });
  });
});

describe('toApiMessage', () => {
  it('keeps only the OpenAI chat fields', async () => {
    const { toApiMessage } = await import('../../../src/side_panel/services/chat/history-ops');
    const out = toApiMessage({
      role: 'user',
      content: 'hi',
      hadImages: true,
      type: 'x',
      meta: { rawText: 'hi', displayText: 'hi' },
    });
    expect(out).toEqual({ role: 'user', content: 'hi' });
  });
});

import { branchFromId, branchInfo, switchBranch, anchorAt, ROOT_BRANCH } from '../../../src/side_panel/services/chat/history-ops';

describe('history-ops branches (F10)', () => {
  const TAB_ID = 7;
  const msg = (id: string, role: 'user' | 'assistant' = 'user') => ({ id, role, content: id });

  it('retrying keeps the replaced continuation as a branch at the fork', () => {
    const ts = makeTabState([msg('u1'), msg('a1', 'assistant'), msg('u2'), msg('a2', 'assistant')]);
    expect(branchFromId(ts, 'u2', TAB_ID)).toBe(2);
    expect(ts.conversationHistory.map((m) => m.id)).toEqual(['u1', 'a1']);
    ts.conversationHistory.push(msg('u2b'), msg('a2b', 'assistant'));
    expect(branchInfo(ts, 'a1')).toEqual({ index: 2, total: 2 });
    expect(anchorAt(ts.conversationHistory, 2)).toBe('a1');
  });

  it('switching swaps the live continuation with the chosen one, both ways', () => {
    const ts = makeTabState([msg('u1'), msg('a1', 'assistant'), msg('u2'), msg('a2', 'assistant')]);
    branchFromId(ts, 'u2', TAB_ID);
    ts.conversationHistory.push(msg('u2b'), msg('a2b', 'assistant'));

    expect(switchBranch(ts, 'a1', 0, TAB_ID)).toBe(true);
    expect(ts.conversationHistory.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(branchInfo(ts, 'a1')).toEqual({ index: 1, total: 2 });

    expect(switchBranch(ts, 'a1', 1, TAB_ID)).toBe(true);
    expect(ts.conversationHistory.map((m) => m.id)).toEqual(['u1', 'a1', 'u2b', 'a2b']);
    expect(switchBranch(ts, 'a1', 1, TAB_ID)).toBe(false); // already active
  });

  it('forks at the first message use the root anchor', () => {
    const ts = makeTabState([msg('u1'), msg('a1', 'assistant')]);
    branchFromId(ts, 'u1', TAB_ID);
    ts.conversationHistory.push(msg('u1b'));
    expect(branchInfo(ts, ROOT_BRANCH)).toEqual({ index: 2, total: 2 });
    switchBranch(ts, ROOT_BRANCH, 0, TAB_ID);
    expect(ts.conversationHistory.map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});
