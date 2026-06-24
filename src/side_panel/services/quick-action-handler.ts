import { t } from '../../shared/i18n.js';
import { getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import { appendMessage } from '../ui/dom-helpers';
import { hasImageErrors, buildOcrContext, collectImageDataUris, clearImagePreviews, validateImageState } from './ocr.js';

type SendToAIFn = (text: string, displayText: string, retryQuote?: string, ocrContext?: string, imageUris?: string[]) => Promise<void>;

let _sendToAI: SendToAIFn;

/**
 * Actions that handleQuickAction knows how to run as a quick chat action
 * (each maps to a prompt sent to the AI). Other `.action-btn` clicks (e.g.
 * 'podcast' handled above, 'annotation' handled by its own feature) must be
 * ignored here, otherwise sendToAI would be called with an undefined prompt.
 */
const KNOWN_ACTIONS = new Set(['summarize', 'translate', 'keyInfo']);

export function initQuickActionHandler({ sendToAI }: { sendToAI: SendToAIFn }): void {
  _sendToAI = sendToAI;
}

export async function handleQuickAction(action: string): Promise<void> {
  if (state.getIsGenerating()) return;

  if (action === 'podcast') {
    emit(EVENTS.PODCAST_CLICK);
    return;
  }

  // Unknown action: the click is handled elsewhere (e.g. the annotation
  // feature wires its own listener). Bail out so we never call sendToAI with
  // an undefined prompt — that would push a malformed
  // {role:'user', content:undefined} into the chat history.
  if (!KNOWN_ACTIONS.has(action)) return;

  const imageError = validateImageState();
  if (imageError) {
    appendMessage('error', imageError);
    return;
  }

  const selectedText = state.getSelectedText();
  const hasSelection = selectedText && selectedText.trim().length > 0;

  const actionPrompts: Record<string, string> = {
    summarize: hasSelection ? getPrompt('summarize.quote', getCurrentLang()) : getPrompt('summarize.full', getCurrentLang()),
    translate: hasSelection ? getPrompt('translate.quote', getCurrentLang()) : getPrompt('translate.full', getCurrentLang()),
    keyInfo: hasSelection ? getPrompt('keyInfo.quote', getCurrentLang()) : getPrompt('keyInfo.full', getCurrentLang()),
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
