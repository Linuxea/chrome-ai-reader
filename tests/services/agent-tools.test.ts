import { vi, describe, it, expect, beforeEach } from 'vitest';

const { tabState } = vi.hoisted(() => ({
  tabState: {
    pageParagraphs: ['Intro to the topic.', 'Quantum entanglement experiment details.', 'Unrelated closing words.'],
    selectedText: 'selected bit',
    pageUrl: 'https://page.example/a',
  } as Record<string, unknown>,
}));
vi.mock('../../src/side_panel/state.js', () => ({ getStateForTab: () => tabState }));
vi.mock('../../src/platform/messaging.js', () => ({ sendMessage: vi.fn(), sendToContentScript: vi.fn() }));
vi.mock('../../src/side_panel/services/page-extractor.js', () => ({ extractTabContent: vi.fn() }));

import { runAgentTool, AGENT_TOOL_SPECS } from '../../src/side_panel/services/agent-tools';
import { sendMessage, sendToContentScript } from '../../src/platform/messaging.js';
import { extractTabContent } from '../../src/side_panel/services/page-extractor.js';

beforeEach(() => vi.clearAllMocks());

describe('services/agent-tools', () => {
  it('declares a JSON-schema object for every tool', () => {
    for (const t of AGENT_TOOL_SPECS) expect(t.parameters).toMatchObject({ type: 'object' });
  });

  it('search_page returns the relevant labelled paragraphs', async () => {
    const out = await runAgentTool('search_page', '{"query":"quantum entanglement"}', 1);
    expect(out).toBe('[#1] Quantum entanglement experiment details.');
  });

  it('read_paragraphs reads a clamped range', async () => {
    expect(await runAgentTool('read_paragraphs', '{"start":1,"end":99}', 1))
      .toBe('[#1] Quantum entanglement experiment details.\n\n[#2] Unrelated closing words.');
  });

  it('get_selection returns the selected text', async () => {
    expect(await runAgentTool('get_selection', '{}', 1)).toBe('selected bit');
  });

  it('search_reading_history explains a missing embedding setup', async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: false, errorKey: 'error.embeddingNotConfigured' });
    expect(await runAgentTool('search_reading_history', '{"query":"rag"}', 1)).toMatch(/not configured/);
  });

  it('read_tab returns the other tab\'s text', async () => {
    vi.mocked(extractTabContent).mockResolvedValueOnce({ ok: true, value: { title: 'Other', textContent: 'Body', excerpt: '', url: 'u' } });
    expect(await runAgentTool('read_tab', '{"tab_id":5}', 1)).toBe('Title: Other\n\nBody');
    expect(extractTabContent).toHaveBeenCalledWith(5);
  });

  it('highlight_paragraph asks the content script', async () => {
    vi.mocked(sendToContentScript).mockResolvedValueOnce({ ok: true });
    expect(await runAgentTool('highlight_paragraph', '{"index":2}', 1)).toBe('Highlighted paragraph #2.');
    expect(sendToContentScript).toHaveBeenCalledWith(1, { action: 'highlightParagraph', text: 'Unrelated closing words.' });
  });

  it('never throws: bad JSON, unknown tools and tool errors become messages', async () => {
    expect(await runAgentTool('search_page', '{oops', 1)).toMatch(/Invalid arguments/);
    expect(await runAgentTool('rm_rf', '{}', 1)).toMatch(/Unknown tool/);
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('boom'));
    expect(await runAgentTool('find_related_pages', '{}', 1)).toMatch(/Tool failed: boom/);
  });
});
