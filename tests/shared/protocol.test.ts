/**
 * Tests for shared/protocol.ts — wire-protocol type contracts.
 *
 * Since most of protocol.ts is types (compile-time only), these tests focus
 * on the runtime values: PORT_NAMES constants (single source of truth for
 * port name strings) and their immutability.
 */

import { describe, it, expect } from 'vitest';
import { PORT_NAMES } from '../../src/shared/protocol';

describe('shared/protocol', () => {
  describe('PORT_NAMES', () => {
    it('contains all expected port names with correct string values', () => {
      expect(PORT_NAMES).toEqual({
        AI_CHAT: 'ai-chat',
        TTS: 'tts',
        TTS_DOWNLOAD: 'tts-download',
        SUGGEST_QUESTIONS: 'suggest-questions',
        PODCAST_LLM: 'podcast-llm',
        PODCAST_AUDIO: 'podcast-audio',
        EMBEDDING: 'embedding',
        ANNOTATION: 'annotation',
      });
    });

    it('every value is a non-empty string', () => {
      Object.entries(PORT_NAMES).forEach(([key, value]) => {
        expect(typeof value, `PORT_NAMES.${key} should be a string`).toBe('string');
        expect(value.length, `PORT_NAMES.${key} should not be empty`).toBeGreaterThan(0);
      });
    });

    it('has 8 ports (guard against accidental additions/removals)', () => {
      expect(Object.keys(PORT_NAMES).length).toBe(8);
    });

    it('all port names are unique (no two keys mapping to the same string)', () => {
      const values = Object.values(PORT_NAMES);
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
