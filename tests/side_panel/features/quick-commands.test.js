import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../../src/shared/constants.js', () => ({
  escapeHtml: (text) => text,
}));

const mockQuickCommands = [];
vi.mock('../../../src/side_panel/state.js', () => ({
  getQuickCommands: vi.fn(() => mockQuickCommands),
  setQuickCommands: vi.fn(),
  getIsGenerating: vi.fn(() => false),
}));

import {
  getFilteredCommands,
  isCommandPopupOpen,
  getCommandSelectedIndex,
  setCommandSelectedIndex,
} from '../../../src/side_panel/features/quick-commands.js';

describe('getFilteredCommands', () => {
  beforeEach(() => {
    mockQuickCommands.length = 0;
    mockQuickCommands.push(
      { name: 'summarize', prompt: 'Summarize this' },
      { name: 'translate', prompt: 'Translate this' },
      { name: 'keyInfo', prompt: 'Extract key info' },
    );
  });

  it('returns all quickCommands when query is empty (just "/")', () => {
    // input "/" → query becomes "" after slice(1)
    expect(getFilteredCommands('/')).toEqual(mockQuickCommands);
  });

  it('returns all quickCommands when input is just "/"', () => {
    const result = getFilteredCommands('/');
    expect(result).toHaveLength(3);
  });

  it('filters commands by name containing the query', () => {
    // "/sum" → query "sum" → matches "summarize"
    const result = getFilteredCommands('/sum');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('summarize');
  });

  it('filters case-insensitively', () => {
    // "/TRANS" → query "trans" (lowercased) → matches "translate"
    const result = getFilteredCommands('/TRANS');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('translate');
  });

  it('returns empty array when no command matches', () => {
    const result = getFilteredCommands('/xyz');
    expect(result).toHaveLength(0);
  });

  it('matches partial name', () => {
    // "key" matches "keyInfo"
    const result = getFilteredCommands('/key');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('keyInfo');
  });

  it('matches "info" inside "keyInfo"', () => {
    const result = getFilteredCommands('/info');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('keyInfo');
  });
});

describe('isCommandPopupOpen', () => {
  it('returns false initially', () => {
    expect(isCommandPopupOpen()).toBe(false);
  });
});

describe('getCommandSelectedIndex', () => {
  it('returns 0 initially', () => {
    expect(getCommandSelectedIndex()).toBe(0);
  });
});

describe('setCommandSelectedIndex', () => {
  it('updates the value retrievable via getCommandSelectedIndex', () => {
    setCommandSelectedIndex(3);
    expect(getCommandSelectedIndex()).toBe(3);
  });

  it('can be reset to 0', () => {
    setCommandSelectedIndex(5);
    setCommandSelectedIndex(0);
    expect(getCommandSelectedIndex()).toBe(0);
  });
});

describe('executeQuickCommand — shared submit pipeline', () => {
  let userInput;
  let onSubmit;

  beforeEach(async () => {
    mockQuickCommands.length = 0;
    mockQuickCommands.push({ name: 'translate', prompt: 'Translate this' });
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn() },
        onChanged: { addListener: vi.fn() },
      },
    });
    document.body.innerHTML = '<textarea id="in"></textarea><div id="popup"></div>';
    userInput = document.getElementById('in');
    onSubmit = vi.fn(() => Promise.resolve());
    const { initQuickCommands } = await import('../../../src/side_panel/features/quick-commands.js');
    initQuickCommands({ userInput, commandPopup: document.getElementById('popup'), onSubmit });
  });

  it('submits the command prompt with an empty draft (attachments come from submit)', async () => {
    const { executeQuickCommand } = await import('../../../src/side_panel/features/quick-commands.js');
    userInput.value = '/translate';
    executeQuickCommand(mockQuickCommands[0]);
    expect(onSubmit).toHaveBeenCalledWith({ prompt: 'Translate this', display: '/translate', draft: '' });
  });

  it('passes text typed after the command name as the draft', async () => {
    const { executeQuickCommand } = await import('../../../src/side_panel/features/quick-commands.js');
    userInput.value = '/translate  focus on part 2 ';
    executeQuickCommand(mockQuickCommands[0]);
    expect(onSubmit).toHaveBeenCalledWith({ prompt: 'Translate this', display: '/translate', draft: 'focus on part 2' });
  });

  it('filters on the command token only, so arguments do not break matching', () => {
    expect(getFilteredCommands('/trans extra words')).toEqual([mockQuickCommands[0]]);
  });
});
