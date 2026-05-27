import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

vi.mock('../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: {
    GENERATE_OUTLINE: 'generateOutline',
    PODCAST_CLICK: 'podcastClick',
    CHART_CLICK: 'chartClick',
  },
}));

vi.mock('../../src/side_panel/ui/dom-helpers.js', () => ({
  appendMessage: vi.fn(),
}));

vi.mock('../../src/side_panel/services/ocr.js', () => ({
  hasImageErrors: vi.fn(() => false),
  buildOcrContext: vi.fn(() => ''),
  collectImageDataUris: vi.fn(() => []),
  clearImagePreviews: vi.fn(),
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
import * as domHelpersMock from '../../src/side_panel/ui/dom-helpers.js';
import * as ocrMock from '../../src/side_panel/services/ocr.js';
import * as stateMock from '../../src/side_panel/state.js';

describe('handleQuickAction', () => {
  const sendToAI = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations after clearAllMocks resets them
    stateMock.getIsGenerating.mockReturnValue(false);
    stateMock.getOcrRunning.mockReturnValue(0);
    stateMock.getSelectedText.mockReturnValue('');
    ocrMock.hasImageErrors.mockReturnValue(false);
    ocrMock.buildOcrContext.mockReturnValue('');
    ocrMock.collectImageDataUris.mockReturnValue([]);
    initQuickActionHandler({ sendToAI });
  });

  it('returns early when AI is generating', async () => {
    stateMock.getIsGenerating.mockReturnValue(true);
    await handleQuickAction('summarize');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('emits GENERATE_OUTLINE for outline action', async () => {
    await handleQuickAction('outline');
    expect(eventsMock.emit).toHaveBeenCalledWith('generateOutline');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('emits PODCAST_CLICK for podcast action', async () => {
    await handleQuickAction('podcast');
    expect(eventsMock.emit).toHaveBeenCalledWith('podcastClick');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('emits CHART_CLICK for chart action', async () => {
    await handleQuickAction('chart');
    expect(eventsMock.emit).toHaveBeenCalledWith('chartClick');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('shows error when OCR is running', async () => {
    stateMock.getOcrRunning.mockReturnValue(1);
    await handleQuickAction('summarize');
    expect(domHelpersMock.appendMessage).toHaveBeenCalledWith('error', '[error.ocrRunning]');
    expect(sendToAI).not.toHaveBeenCalled();
  });

  it('shows error when image has errors (OCR partial fail)', async () => {
    document.body.innerHTML = '<div class="image-preview-item error" title="bad image"></div>';
    ocrMock.hasImageErrors.mockReturnValue(true);
    await handleQuickAction('summarize');
    expect(domHelpersMock.appendMessage).toHaveBeenCalledWith('error', '[error.ocrPartialFail]：bad image');
    expect(sendToAI).not.toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  it('shows error without reason when error element has no title', async () => {
    document.body.innerHTML = '<div class="image-preview-item error"></div>';
    ocrMock.hasImageErrors.mockReturnValue(true);
    await handleQuickAction('summarize');
    expect(domHelpersMock.appendMessage).toHaveBeenCalledWith('error', '[error.ocrPartialFail]');
    document.body.innerHTML = '';
  });

  it('calls sendToAI with full summarize prompt when no selection', async () => {
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledWith(
      '[prompt.summarize.full]',
      '[action.summarize]',
      undefined,
      '',
      [],
    );
  });

  it('calls sendToAI with quote summarize prompt when text is selected', async () => {
    stateMock.getSelectedText.mockReturnValue('some selected text');
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledWith(
      '[prompt.summarize.quote]',
      '[action.summarize]',
      undefined,
      '',
      [],
    );
  });

  it('calls sendToAI with translate prompts', async () => {
    await handleQuickAction('translate');
    expect(sendToAI).toHaveBeenCalledWith(
      '[prompt.translate.full]',
      '[action.translate]',
      undefined,
      '',
      [],
    );
  });

  it('calls sendToAI with keyInfo prompts', async () => {
    await handleQuickAction('keyInfo');
    expect(sendToAI).toHaveBeenCalledWith(
      '[prompt.keyInfo.full]',
      '[action.keyInfo]',
      undefined,
      '',
      [],
    );
  });

  it('passes OCR context and image URIs to sendToAI', async () => {
    ocrMock.buildOcrContext.mockReturnValue('OCR result text');
    ocrMock.collectImageDataUris.mockReturnValue(['data:image/png;base64,abc']);
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledWith(
      '[prompt.summarize.full]',
      '[action.summarize]',
      undefined,
      'OCR result text',
      ['data:image/png;base64,abc'],
    );
    expect(ocrMock.clearImagePreviews).toHaveBeenCalled();
  });

  it('ignores whitespace-only selected text (treats as no selection)', async () => {
    stateMock.getSelectedText.mockReturnValue('   ');
    await handleQuickAction('summarize');
    expect(sendToAI).toHaveBeenCalledWith(
      '[prompt.summarize.full]',
      '[action.summarize]',
      undefined,
      '',
      [],
    );
  });
});
