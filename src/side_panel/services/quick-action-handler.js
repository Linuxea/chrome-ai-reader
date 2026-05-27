// services/quick-action-handler.js — 快捷操作分发（摘要、翻译、要点、大纲、播客、图表）

import { t } from '../../shared/i18n.js';
import * as state from '../state.js';
import { emit, EVENTS } from '../events.js';
import { appendMessage } from '../ui/dom-helpers.js';
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews } from './ocr.js';

// sendToAI 通过 init 注入，避免 message-sender ↔ quick-action-handler 循环依赖
let _sendToAI;

export function initQuickActionHandler({ sendToAI }) {
  _sendToAI = sendToAI;
}

export async function handleQuickAction(action) {
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

  if (state.getOcrRunning() > 0) {
    appendMessage('error', t('error.ocrRunning'));
    return;
  }

  if (hasImageErrors()) {
    const firstError = document.querySelector('.image-preview-item.error');
    const reason = firstError?.title || '';
    appendMessage('error', t('error.ocrPartialFail') + (reason ? `：${reason}` : ''));
    return;
  }

  const selectedText = state.getSelectedText();
  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts = {
    summarize: hasSelection ? t('prompt.summarize.quote') : t('prompt.summarize.full'),
    translate: hasSelection ? t('prompt.translate.quote') : t('prompt.translate.full'),
    keyInfo: hasSelection ? t('prompt.keyInfo.quote') : t('prompt.keyInfo.full')
  };

  const actionNames = {
    summarize: t('action.summarize'),
    translate: t('action.translate'),
    keyInfo: t('action.keyInfo')
  };

  const ocrContext = buildOcrContext();
  const imageUris = collectImageDataUris();
  clearImagePreviews();

  await _sendToAI(actionPrompts[action], actionNames[action], undefined, ocrContext, imageUris);
}
