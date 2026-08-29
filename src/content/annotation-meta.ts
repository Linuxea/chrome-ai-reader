import type { AnnotationPerspective } from '../shared/types';

export const ICON_BY_PERSPECTIVE: Record<AnnotationPerspective, string> = {
  critique: '🤨',
  counterpoint: '⚖️',
  flaw: '🔍',
};

type Lang = 'zh' | 'en';

let _lang: Lang = 'zh';

const LABELS_BY_LANG: Record<Lang, Record<AnnotationPerspective, string>> = {
  zh: { critique: '批判', counterpoint: '反方', flaw: '漏洞' },
  en: { critique: 'Critique', counterpoint: 'Counter', flaw: 'Flaw' },
};

const UI_BY_LANG: Record<Lang, { followUp: string; close: string }> = {
  zh: { followUp: '↩ 在对话中追问', close: '关闭' },
  en: { followUp: '↩ Follow up in chat', close: 'Close' },
};

/**
 * Load the UI language once (annotation init) — the content script cannot use
 * shared/i18n.js (it touches document / panel-only state), so read the same
 * `language` storage key the service worker normalizes.
 */
export async function initAnnotationLang(): Promise<void> {
  try {
    const { language } = (await chrome.storage.sync.get(['language'])) as { language?: string };
    _lang = language === 'en' ? 'en' : 'zh';
  } catch {
    _lang = 'zh';
  }
}

export function getPerspectiveLabel(perspective: AnnotationPerspective): string {
  return LABELS_BY_LANG[_lang][perspective];
}

export function getBubbleTexts(): { followUp: string; close: string } {
  return UI_BY_LANG[_lang];
}
