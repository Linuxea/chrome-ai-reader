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
