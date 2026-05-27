import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
  getCurrentLang: vi.fn(() => 'zh'),
}));

vi.mock('../../../src/shared/constants.js', () => ({
  escapeHtml: (text) => text,
}));

vi.mock('../../../src/shared/format.js', () => ({
  formatDate: (ts) => `formatted:${ts}`,
}));

vi.mock('../../../src/shared/download.js', () => ({
  downloadFile: vi.fn(),
}));

vi.mock('../../../src/side_panel/state.js', () => ({
  getCurrentChatId: vi.fn(() => null),
  getConversationHistory: vi.fn(() => []),
  getPageTitle: vi.fn(() => 'Test Page'),
  setCurrentChatId: vi.fn(),
  getIsGenerating: vi.fn(() => false),
}));

vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({
  scrollToBottom: vi.fn(),
}));

vi.mock('marked', () => ({
  marked: { parse: (text) => `<p>${text}</p>` },
}));

import {
  generateTitle,
  sanitizeFilename,
  stripHtml,
} from '../../../src/side_panel/features/chat-history.js';

describe('generateTitle', () => {
  it('returns full text when user message < 30 chars', () => {
    const messages = [{ role: 'user', content: 'Hello world' }];
    expect(generateTitle(messages)).toBe('Hello world');
  });

  it('truncates with "..." when user message > 30 chars', () => {
    const long = 'a'.repeat(40);
    const messages = [{ role: 'user', content: long }];
    expect(generateTitle(messages)).toBe('a'.repeat(30) + '...');
  });

  it('returns default when no user message', () => {
    const messages = [{ role: 'assistant', content: 'hi' }];
    expect(generateTitle(messages)).toBe('[chat.newChat]');
  });

  it('does not add ellipsis when user message is exactly 30 chars', () => {
    const exact = 'b'.repeat(30);
    const messages = [{ role: 'user', content: exact }];
    expect(generateTitle(messages)).toBe(exact);
  });
});

describe('sanitizeFilename', () => {
  it('replaces slashes and backslashes', () => {
    expect(sanitizeFilename('foo/bar\\baz')).toBe('foo_bar_baz');
  });

  it('replaces colons, asterisks, question marks', () => {
    expect(sanitizeFilename('a:b*c?d')).toBe('a_b_c_d');
  });

  it('replaces angle brackets and pipe', () => {
    expect(sanitizeFilename('<a>|b')).toBe('_a__b');
  });

  it('replaces newlines and carriage returns', () => {
    expect(sanitizeFilename('line1\nline2\rline3')).toBe('line1_line2_line3');
  });

  it('replaces double quotes', () => {
    expect(sanitizeFilename('say "hello"')).toBe('say _hello_');
  });

  it('truncates to 30 chars', () => {
    expect(sanitizeFilename('a'.repeat(50)).length).toBe(30);
  });

  it('returns unchanged when no unsafe chars and <= 30', () => {
    expect(sanitizeFilename('simple title 123')).toBe('simple title 123');
  });

  it('handles empty string', () => {
    expect(sanitizeFilename('')).toBe('');
  });
});

describe('stripHtml', () => {
  it('strips HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('handles HTML entities', () => {
    expect(stripHtml('a &amp; b &lt; c')).toBe('a & b < c');
  });

  it('passes plain text through', () => {
    expect(stripHtml('just text')).toBe('just text');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});
