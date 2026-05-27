import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../../src/shared/constants.js', () => ({
  TRUNCATE_LIMITS: { CONTEXT: 64000, QUOTE: 64000 },
  safeTruncate: (text, max) => text?.slice(0, max) || text,
  escapeHtml: (text) => text,
}));

vi.mock('../../../src/shared/json-repair.js', () => ({
  stripMarkdownFence: (text) =>
    text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''),
}));

vi.mock('marked', () => ({
  marked: { parse: (text) => `<p>${text}</p>` },
}));

vi.mock('../../../src/side_panel/state.js', () => ({
  getIsGenerating: vi.fn(() => false),
  getPageContent: vi.fn(() => 'test content'),
  getCustomSystemPrompt: vi.fn(() => ''),
  pushConversation: vi.fn(),
  setIsGenerating: vi.fn(),
}));

vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
}));

vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({
  appendMessage: vi.fn(),
  scrollToBottom: vi.fn(),
  setButtonsDisabled: vi.fn(),
}));

vi.mock('../../../src/side_panel/services/tts/index.js', () => ({
  stopTTS: vi.fn(),
}));

import {
  parseOutlineResponse,
  outlineToMarkdown,
  sectionToMarkdown,
} from '../../../src/side_panel/features/outline.js';

// ---------------------------------------------------------------------------
// parseOutlineResponse
// ---------------------------------------------------------------------------

describe('parseOutlineResponse', () => {
  it('returns null for null', () => {
    expect(parseOutlineResponse(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseOutlineResponse(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOutlineResponse('')).toBeNull();
  });

  it('parses valid JSON with title and sections', () => {
    const input = JSON.stringify({
      title: 'Test',
      sections: [{ heading: 'Intro' }],
    });
    const result = parseOutlineResponse(input);
    expect(result).toBeTruthy();
    expect(result.title).toBe('Test');
    expect(result.sections).toHaveLength(1);
  });

  it('returns null for valid JSON missing title', () => {
    const input = JSON.stringify({ sections: [] });
    expect(parseOutlineResponse(input)).toBeNull();
  });

  it('returns null for valid JSON missing sections', () => {
    const input = JSON.stringify({ title: 'No sections' });
    expect(parseOutlineResponse(input)).toBeNull();
  });

  it('parses JSON wrapped in a markdown fence', () => {
    const obj = { title: 'Fenced', sections: [{ heading: 'A' }] };
    const input = '```json\n' + JSON.stringify(obj) + '\n```';
    const result = parseOutlineResponse(input);
    expect(result).toBeTruthy();
    expect(result.title).toBe('Fenced');
  });

  it('returns null for invalid JSON', () => {
    expect(parseOutlineResponse('not json at all')).toBeNull();
  });

  it('returns null for fenced invalid JSON', () => {
    expect(parseOutlineResponse('```json\nnot json\n```')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// outlineToMarkdown
// ---------------------------------------------------------------------------

describe('outlineToMarkdown', () => {
  it('returns empty string for null', () => {
    expect(outlineToMarkdown(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(outlineToMarkdown(undefined)).toBe('');
  });

  it('converts a simple outline with title and one section', () => {
    const data = {
      title: 'My Doc',
      sections: [{ heading: 'Intro' }],
    };
    const md = outlineToMarkdown(data);
    expect(md).toContain('# My Doc');
    expect(md).toContain('## Intro');
  });

  it('renders sections with children at deeper heading levels', () => {
    const data = {
      title: 'Root',
      sections: [
        {
          heading: 'Parent',
          children: [{ heading: 'Child' }],
        },
      ],
    };
    const md = outlineToMarkdown(data);
    expect(md).toContain('## Parent');
    expect(md).toContain('### Child');
  });

  it('includes summary, data bullets, and blockquote', () => {
    const data = {
      title: 'Rich',
      sections: [
        {
          heading: 'S1',
          summary: 'A summary',
          data: ['point A', 'point B'],
          quote: 'famous words',
        },
      ],
    };
    const md = outlineToMarkdown(data);
    expect(md).toContain('A summary');
    expect(md).toContain('- point A');
    expect(md).toContain('- point B');
    expect(md).toContain('> famous words');
  });
});

// ---------------------------------------------------------------------------
// sectionToMarkdown
// ---------------------------------------------------------------------------

describe('sectionToMarkdown', () => {
  it('generates a heading at the given level', () => {
    const md = sectionToMarkdown({ heading: 'Hello' }, 3);
    expect(md).toMatch(/^### Hello/);
  });

  it('includes all optional fields', () => {
    const section = {
      heading: 'Full',
      summary: 'the summary',
      data: ['d1', 'd2'],
      quote: 'quoted text',
    };
    const md = sectionToMarkdown(section, 2);
    expect(md).toContain('## Full');
    expect(md).toContain('the summary');
    expect(md).toContain('- d1');
    expect(md).toContain('- d2');
    expect(md).toContain('> quoted text');
  });

  it('recursively renders children at level + 1', () => {
    const section = {
      heading: 'Parent',
      children: [
        {
          heading: 'Kid',
          summary: 'kid summary',
        },
      ],
    };
    const md = sectionToMarkdown(section, 2);
    expect(md).toContain('## Parent');
    expect(md).toContain('### Kid');
    expect(md).toContain('kid summary');
  });

  it('handles section with no optional fields', () => {
    const md = sectionToMarkdown({ heading: 'Bare' }, 4);
    expect(md).toContain('#### Bare');
    expect(md).not.toContain('- ');
    expect(md).not.toContain('> ');
  });

  it('handles multiline quote with blockquote prefix on each line', () => {
    const section = {
      heading: 'Quote',
      quote: 'line1\nline2',
    };
    const md = sectionToMarkdown(section, 2);
    expect(md).toContain('> line1\n> line2');
  });
});
