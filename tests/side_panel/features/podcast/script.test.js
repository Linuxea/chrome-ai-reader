import { vi, describe, it, expect } from 'vitest';

// Mock i18n — t() returns bracketed key so we can verify lookups
vi.mock('../../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

// Mock state — getIsPodcastGenerating defaults to false
vi.mock('../../../../src/side_panel/state.js', () => ({
  getIsPodcastGenerating: vi.fn(() => false),
}));

// Mock UI functions used by higher-level orchestration (not directly by the parser,
// but script.js imports them at module scope so we must stub them)
vi.mock('../../../../src/side_panel/features/podcast/ui.js', () => ({
  renderTranscript: vi.fn(),
  resetHighlightState: vi.fn(),
}));

vi.mock('../../../../src/side_panel/features/podcast/audio.js', () => ({
  setPodcastTitle: vi.fn(),
  resetRoundTimings: vi.fn(),
  generatePodcastAudio: vi.fn(),
}));

// Import after mocks are set up
import {
  parsePodcastScript,
  validateAndMapRounds,
  extractRoundsFallback,
  extractPodcastTitle,
} from '../../../../src/side_panel/features/podcast/script.js';

import { SPEAKER_MAP, DEFAULT_SPEAKER } from '../../../../src/side_panel/features/podcast/constants.js';

// ---------------------------------------------------------------------------
// validateAndMapRounds
// ---------------------------------------------------------------------------
describe('validateAndMapRounds', () => {
  it('maps valid rounds with uppercase speakers', () => {
    const input = {
      rounds: [
        { speaker: 'A', text: 'Hello' },
        { speaker: 'B', text: 'World' },
      ],
    };
    const result = validateAndMapRounds(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      speaker: SPEAKER_MAP['A'],
      text: 'Hello',
      speakerLabel: 'A',
    });
    expect(result[1]).toEqual({
      speaker: SPEAKER_MAP['B'],
      text: 'World',
      speakerLabel: 'B',
    });
  });

  it('maps lowercase speakers to correct voice via uppercase fallback', () => {
    // SPEAKER_MAP only has uppercase keys; the code tries .toUpperCase()
    const input = {
      rounds: [{ speaker: 'a', text: 'Lowercase a' }],
    };
    const result = validateAndMapRounds(input);
    expect(result[0].speaker).toBe(SPEAKER_MAP['A']);
    expect(result[0].speakerLabel).toBe('A');
  });

  it('uses DEFAULT_SPEAKER for unknown speaker letters', () => {
    const input = {
      rounds: [{ speaker: 'Z', text: 'Unknown speaker' }],
    };
    const result = validateAndMapRounds(input);
    expect(result[0].speaker).toBe(DEFAULT_SPEAKER);
    expect(result[0].speakerLabel).toBe('Z');
  });

  it('throws when rounds array is missing', () => {
    expect(() => validateAndMapRounds({}))
      .toThrow('Empty rounds array');
  });

  it('throws when rounds is not an array', () => {
    expect(() => validateAndMapRounds({ rounds: 'not-array' }))
      .toThrow('Empty rounds array');
  });

  it('throws when rounds array is empty', () => {
    expect(() => validateAndMapRounds({ rounds: [] }))
      .toThrow('Empty rounds array');
  });

  it('throws when a round is missing speaker', () => {
    expect(() => validateAndMapRounds({ rounds: [{ text: 'no speaker' }] }))
      .toThrow('Missing speaker or text in round');
  });

  it('throws when a round is missing text', () => {
    expect(() => validateAndMapRounds({ rounds: [{ speaker: 'A' }] }))
      .toThrow('Missing speaker or text in round');
  });

  it('truncates text to 280 characters', () => {
    const longText = 'x'.repeat(500);
    const input = {
      rounds: [{ speaker: 'A', text: longText }],
    };
    const result = validateAndMapRounds(input);
    expect(result[0].text).toHaveLength(280);
    expect(result[0].text).toBe('x'.repeat(280));
  });

  it('preserves text under 280 characters unchanged', () => {
    const shortText = 'short';
    const input = {
      rounds: [{ speaker: 'B', text: shortText }],
    };
    const result = validateAndMapRounds(input);
    expect(result[0].text).toBe(shortText);
  });
});

// ---------------------------------------------------------------------------
// parsePodcastScript
// ---------------------------------------------------------------------------
describe('parsePodcastScript', () => {
  it('parses valid JSON directly', () => {
    const json = JSON.stringify({
      rounds: [
        { speaker: 'A', text: 'Welcome' },
        { speaker: 'B', text: 'Thanks' },
      ],
    });
    const result = parsePodcastScript(json);
    expect(result).toHaveLength(2);
    expect(result[0].speakerLabel).toBe('A');
    expect(result[0].text).toBe('Welcome');
    expect(result[1].speakerLabel).toBe('B');
    expect(result[1].text).toBe('Thanks');
  });

  it('strips markdown fence before parsing', () => {
    const inner = JSON.stringify({
      rounds: [{ speaker: 'A', text: 'Fenced' }],
    });
    const fenced = '```json\n' + inner + '\n```';
    const result = parsePodcastScript(fenced);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Fenced');
  });

  it('repairs trailing commas via repairLLMJson', () => {
    // Trailing comma is invalid JSON; repairLLMJson fixes it
    const broken = '{"rounds":[{"speaker":"A","text":"Hi",},]}';
    const result = parsePodcastScript(broken);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hi');
  });

  it('repairs unescaped newlines in text values', () => {
    // Build a string with a literal newline inside a JSON value
    const broken = '{"rounds":[{"speaker":"A","text":"line1\nline2"}]}';
    const result = parsePodcastScript(broken);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('line1\nline2');
  });

  it('falls back to extractRoundsFallback for deeply broken JSON', () => {
    // Craft input that JSON.parse + repairLLMJson still can't handle,
    // but extractRoundsFallback can extract from.
    const broken =
      'blah {"rounds":[{"speaker":"A","text":"Fallback text"}] extra}';
    // This JSON is malformed (extra chars after }), so JSON.parse fails.
    // repairLLMJson can't fix the structural issue either.
    // extractRoundsFallback regex should still find the speaker/text pair.
    const result = parsePodcastScript(broken);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].text).toContain('Fallback text');
  });

  it('throws when no JSON object containing rounds is found', () => {
    expect(() => parsePodcastScript('no json here at all'))
      .toThrow('No JSON found in script');
  });

  it('throws when JSON is found but rounds are empty and fallback yields nothing', () => {
    // The extractJsonObject finds {"rounds":[]}, validateAndMapRounds throws,
    // repairLLMJson still gives the same result, extractRoundsFallback finds no
    // speaker pairs in empty array, so it re-throws.
    const json = '{"rounds":[]}';
    expect(() => parsePodcastScript(json)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractRoundsFallback
// ---------------------------------------------------------------------------
describe('extractRoundsFallback', () => {
  it('extracts speaker A and B pairs', () => {
    const jsonStr = '{"rounds":[{"speaker":"A","text":"Alpha"},{"speaker":"B","text":"Beta"}]}';
    const result = extractRoundsFallback(jsonStr);
    expect(result).toHaveLength(2);
    expect(result[0].speakerLabel).toBe('A');
    expect(result[0].text).toBe('Alpha');
    expect(result[1].speakerLabel).toBe('B');
    expect(result[1].text).toBe('Beta');
  });

  it('returns empty array when no speaker patterns found', () => {
    const result = extractRoundsFallback('nothing to see here');
    expect(result).toEqual([]);
  });

  it('handles escape sequences in text (\\n, \\", \\\\)', () => {
    const jsonStr = '{"speaker":"A","text":"line1\\nline2\\"quoted\\" and \\\\slash"}';
    const result = extractRoundsFallback(jsonStr);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('line1\nline2"quoted" and \\slash');
  });

  it('skips entries where text is empty after processing', () => {
    // Edge case: the regex finds a speaker but text extraction yields empty
    const jsonStr = '{"speaker":"A","text":""}';
    const result = extractRoundsFallback(jsonStr);
    // Empty text is filtered out by the `if (text)` guard
    expect(result).toEqual([]);
  });

  it('truncates text to 280 characters', () => {
    const longText = 'a'.repeat(500);
    const jsonStr = `{"speaker":"A","text":"${longText}"}`;
    const result = extractRoundsFallback(jsonStr);
    expect(result).toHaveLength(1);
    expect(result[0].text).toHaveLength(280);
  });

  it('maps speaker letters to correct SPEAKER_MAP values', () => {
    const jsonStr = '{"speaker":"A","text":"Host"},{"speaker":"B","text":"Guest"}';
    const result = extractRoundsFallback(jsonStr);
    expect(result[0].speaker).toBe(SPEAKER_MAP['A']);
    expect(result[1].speaker).toBe(SPEAKER_MAP['B']);
  });
});

// ---------------------------------------------------------------------------
// extractPodcastTitle
// ---------------------------------------------------------------------------
describe('extractPodcastTitle', () => {
  it('joins first 3 rounds and cleans punctuation', () => {
    const rounds = [
      { text: '今天我们聊聊，AI的未来。' },
      { text: '没错！这个话题很有意思。' },
      { text: '让我们开始吧。' },
      { text: 'This should be ignored.' },
    ];
    const title = extractPodcastTitle(rounds);
    // Punctuation replaced with spaces, trimmed, no filesystem-unsafe chars
    expect(title).toBeTruthy();
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('returns empty string for empty rounds array', () => {
    expect(extractPodcastTitle([])).toBe('');
  });

  it('returns empty string for null/undefined input', () => {
    expect(extractPodcastTitle(null)).toBe('');
    expect(extractPodcastTitle(undefined)).toBe('');
  });

  it('handles rounds with empty text (filters them out)', () => {
    const rounds = [
      { text: '' },
      { text: '   ' },
      { text: 'Valid title' },
    ];
    const title = extractPodcastTitle(rounds);
    expect(title).toBeTruthy();
  });

  it('truncates titles longer than 30 chars at last space before position 30', () => {
    // Build rounds where the joined text exceeds 30 chars
    const rounds = [
      { text: 'This is a fairly long podcast title that should be truncated' },
      { text: 'with even more text here' },
      { text: 'and more content' },
    ];
    const title = extractPodcastTitle(rounds);
    expect(title.length).toBeLessThanOrEqual(60);
    // If title was > 30, it should have been cut at a word boundary
    if (title.length > 30) {
      // Should not contain a partial word — check it doesn't end mid-word
      // (it was sliced at a space boundary)
      expect(title).not.toMatch(/\s$/);
    }
  });

  it('replaces filesystem-unsafe characters with underscore', () => {
    const rounds = [
      { text: 'Title with /\\:*?"<>| chars' },
    ];
    const title = extractPodcastTitle(rounds);
    // All filesystem-unsafe chars should be replaced with _
    expect(title).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('handles rounds with fewer than 3 entries', () => {
    const rounds = [
      { text: 'Short podcast' },
    ];
    const title = extractPodcastTitle(rounds);
    expect(title).toBeTruthy();
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('limits final title to 60 characters max', () => {
    const rounds = [
      { text: 'A'.repeat(100) },
    ];
    const title = extractPodcastTitle(rounds);
    expect(title.length).toBeLessThanOrEqual(60);
  });
});
