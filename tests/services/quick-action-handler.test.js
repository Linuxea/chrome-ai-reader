import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
  getCurrentLang: () => 'zh',
}));

vi.mock('../../src/shared/prompts', () => ({
  getPrompt: (key) => `[${key}]`,
}));

vi.mock('../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: {
    PODCAST_CLICK: 'podcastClick',
  },
}));


vi.mock('../../src/side_panel/state.js', () => ({
  getIsGenerating: vi.fn(() => false),
  getOcrRunning: vi.fn(() => 0),
  getSelectedText: vi.fn(() => ''),
}));

import {
  initQuickActionHandler,
  handleQuickAction,
} from '../../src/side_panel/services/quick-action-handler.js';

import * as eventsMock from '../../src/side_panel/events.js';
import * as stateMock from '../../src/side_panel/state.js';

describe('handleQuickAction', () => {
  const sendToAI = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations after clearAllMocks resets them
    stateMock.getIsGenerating.mockReturnValue(false);
    stateMock.getOcrRunning.mockReturnValue(0);
    stateMock.getSelectedText.mockReturnValue('');
    initQuickActionHandler({ submit: sendToAI });
  });

  it('returns early when AI is generating', async () => {
    stateMock.getIsGenerating.mockReturnValue(true);
    await handleQuickAction('summarize');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('emits PODCAST_CLICK for podcast action', async () => {
    await handleQuickAction('podcast');
    expect(eventsMock.emit).toHaveBeenCalledWith('podcastClick');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('does NOT call sendToAI for an unknown action (e.g. annotation button)', async () => {
    // Regression: every .action-btn gets handleQuickAction bound to its click,
    // but only summarize/translate/keyInfo/podcast are real quick actions. An
    // unknown action (like 'annotation') must not call sendToAI with an
    // undefined prompt — that would push {role:'user', content:undefined} into
    // the chat history and produce a malformed API request.
    await handleQuickAction('annotation');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('calls sendToAI with full summarize prompt when no selection', async () => {
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledWith({ prompt: '[summarize.full]', display: '[action.summarize]' });
  });

  it('calls sendToAI with quote summarize prompt when text is selected', async () => {
    stateMock.getSelectedText.mockReturnValue('some selected text');
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledWith({ prompt: '[summarize.quote]', display: '[action.summarize]' });
  });

  it('calls sendToAI with translate prompts', async () => {
    await handleQuickAction('translate');
    expect(sendToAI).toHaveBeenCalledWith({ prompt: '[translate.full]', display: '[action.translate]' });
  });

  it('calls sendToAI with keyInfo prompts', async () => {
    await handleQuickAction('keyInfo');
    expect(sendToAI).toHaveBeenCalledWith({ prompt: '[keyInfo.full]', display: '[action.keyInfo]' });
  });

  it('delegates validation and attachments to the shared submit pipeline', async () => {
    // Images / OCR text / draft handling live in submit() (message-sender),
    // so a quick action only states its prompt + label.
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledTimes(1);
    expect(sendToAI.mock.calls[0]).toHaveLength(1);
  });

  it('ignores whitespace-only selected text (treats as no selection)', async () => {
    stateMock.getSelectedText.mockReturnValue('   ');
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledWith({ prompt: '[summarize.full]', display: '[action.summarize]' });
  });
});
