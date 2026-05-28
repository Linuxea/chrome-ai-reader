import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import { appendMessage } from '../ui/dom-helpers';
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews, validateImageState } from './ocr.js';

type SendToAIFn = (text: string, displayText: string, retryQuote?: string, ocrContext?: string, imageUris?: string[]) => Promise<void>;

let _sendToAI: SendToAIFn;

export function initQuickActionHandler({ sendToAI }: { sendToAI: SendToAIFn }): void {
  _sendToAI = sendToAI;
}

export async function handleQuickAction(action: string): Promise<void> {
  if (state.getIsGenerating()) return;

  if (action === 'outline') {
    emit(EVENTS.GENERATE_OUTLINE);
    return;
  }

  if (action === 'podcast') {
    emit(EVENTS.PODCAST_CLICK);
    return;
  }

  if (action === 'chart') {
    emit(EVENTS.CHART_CLICK);
    return;
  }

  const imageError = validateImageState();
  if (imageError) {
    appendMessage('error', imageError);
    return;
  }

  const selectedText = state.getSelectedText();
  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts: Record<string, string> = {
    summarize: hasSelection ? t('prompt.summarize.quote') : t('prompt.summarize.full'),
    translate: hasSelection ? t('prompt.translate.quote') : t('prompt.translate.full'),
    keyInfo: hasSelection ? t('prompt.keyInfo.quote') : t('prompt.keyInfo.full'),
  };

  const actionNames: Record<string, string> = {
    summarize: t('action.summarize'),
    translate: t('action.translate'),
    keyInfo: t('action.keyInfo'),
  };

  const ocrContext = buildOcrContext();
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await _sendToAI(actionPrompts[action], actionNames[action], undefined, ocrContext, imageUris);
}
