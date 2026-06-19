import { vi, describe, it, expect } from 'vitest';
import { buildAnnotationMessages, parseAnnotationResponse, ANNOTATION_SYSTEM_PROMPT } from '../../src/background/sw-annotation.js';
import type { Annotation } from '../../src/shared/types';

describe('sw-annotation prompt assembly', () => {
  describe('ANNOTATION_SYSTEM_PROMPT', () => {
    it('defines the three perspectives', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('critique');
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('counterpoint');
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('flaw');
    });

    it('demands verbatim quotes', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toMatch(/原样|verbatim|真实存在/);
    });

    it('allows returning empty when nothing is worth annotating', () => {
      expect(ANNOTATION_SYSTEM_PROMPT).toContain('宁缺毋滥');
    });
  });

  describe('buildAnnotationMessages', () => {
    it('returns system + user messages with full article and target chunk', () => {
      const messages = buildAnnotationMessages({
        fullArticle: 'FULL ARTICLE TEXT',
        chunkIndex: 3,
        chunkText: 'TARGET CHUNK TEXT',
      });

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'system', content: ANNOTATION_SYSTEM_PROMPT });

      const user = messages[1].content as string;
      expect(user).toContain('FULL ARTICLE TEXT');
      expect(user).toContain('TARGET CHUNK TEXT');
      expect(user).toContain('<full_article>');
      expect(user).toContain('<target_chunk>');
      expect(user).toContain('第 3 段');
    });
  });

  describe('parseAnnotationResponse', () => {
    it('parses a valid response into Annotation[]', () => {
      const raw = JSON.stringify({
        annotations: [
          { perspective: 'critique', quote: '性能提升 30%', comment: '基线是什么？' },
          { perspective: 'flaw', quote: '因此 A 导致 B', comment: '推理跳步。' },
        ],
      });

      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(2);
      expect(result[0].perspective).toBe('critique');
      expect(result[0].quote).toBe('性能提升 30%');
      expect(result[0].id).toMatch(/^[\da-f-]{36}$/i); // UUID shape
    });

    it('returns empty array when model reports no worthy points', () => {
      const result = parseAnnotationResponse(JSON.stringify({ annotations: [] }));
      expect(result).toEqual([]);
    });

    it('drops annotations with invalid perspective or missing fields', () => {
      const raw = JSON.stringify({
        annotations: [
          { perspective: 'critique', quote: 'good', comment: 'ok' },
          { perspective: 'bogus', quote: 'bad', comment: 'no' },        // invalid perspective
          { perspective: 'flaw', quote: '', comment: 'empty quote' },    // empty quote
          { perspective: 'flaw', quote: 'no comment' },                  // missing comment
        ],
      });
      const result = parseAnnotationResponse(raw);
      expect(result).toHaveLength(1);
      expect(result[0].perspective).toBe('critique');
    });

    it('returns empty array on malformed JSON', () => {
      expect(parseAnnotationResponse('not json')).toEqual([]);
      expect(parseAnnotationResponse('')).toEqual([]);
    });
  });
});
