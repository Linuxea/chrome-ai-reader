/**
 * Deep annotation (React port) — per-tab state machine
 *   idle → annotating → done → (click) → idle
 *                     ↘ error → (click) → idle
 * Messages from the content script update the tab's state; the button
 * label derives from it. Follow-up reuses the quote bar (selectedText) and
 * fills the composer draft.
 */
import { create } from 'zustand';
import { t } from '@/shared/i18n.js';
import { sendToContentScript } from '@/platform/messaging';
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useComposerStore } from '@/panel/stores/composer-store';

export type TabAnnotation =
  | { kind: 'idle' }
  | { kind: 'annotating'; done: number; total: number }
  | { kind: 'done'; count: number; failed: number }
  | { kind: 'error'; error: string };

const IDLE: TabAnnotation = { kind: 'idle' };

interface AnnotationStore {
  byTab: Record<number, TabAnnotation>;
  _set: (tabId: number, next: TabAnnotation) => void;
}

export const useAnnotationStore = create<AnnotationStore>()(set => ({
  byTab: {},
  _set: (tabId, next) =>
    set(s => {
      const byTab = { ...s.byTab };
      if (next.kind === 'idle') delete byTab[tabId];
      else byTab[tabId] = next;
      return { byTab };
    }),
}));

export function annotationFor(tabId: number | null): TabAnnotation {
  return (tabId != null && useAnnotationStore.getState().byTab[tabId]) || IDLE;
}

export async function onAnnotationClick(): Promise<void> {
  const tabId = core.getActiveTabId();
  if (tabId == null) return;
  const cur = annotationFor(tabId);
  const _set = useAnnotationStore.getState()._set;

  if (cur.kind === 'done' || cur.kind === 'error') {
    _set(tabId, IDLE);
    sendToContentScript(tabId, { action: 'clearAnnotation' }).catch(() => { /* page gone */ });
    return;
  }
  if (cur.kind === 'idle') {
    _set(tabId, { kind: 'annotating', done: 0, total: 0 });
    try {
      await sendToContentScript(tabId, { action: 'startAnnotation' });
    } catch {
      _set(tabId, { kind: 'error', error: t('error.pageUnsupported') });
    }
  }
}

let _initialized = false;

/** Install the runtime-message bridge (called once from App). */
export function initAnnotation(): void {
  if (_initialized) return;
  _initialized = true;
  chrome.runtime.onMessage.addListener((msg: Record<string, unknown>, sender?: chrome.runtime.MessageSender) => {
    const action = msg.action as string;
    if (!action?.startsWith('annotation')) return;
    const tabId = sender?.tab?.id;
    if (tabId == null) return;
    const _set = useAnnotationStore.getState()._set;

    if (action === 'annotationProgress') {
      _set(tabId, { kind: 'annotating', done: Number(msg.done) || 0, total: Number(msg.total) || 0 });
    } else if (action === 'annotationDone') {
      _set(tabId, { kind: 'done', count: Number(msg.count) || 0, failed: (msg.failed as number) || 0 });
    } else if (action === 'annotationFailed') {
      _set(tabId, { kind: 'error', error: (msg.error as string) || '' });
    } else if (action === 'annotationFollowUp') {
      if (tabId !== core.getActiveTabId()) return;
      const quote = (msg.quote as string) || '';
      const comment = (msg.comment as string) || '';
      if (quote) useTabsStore.getState().setSelectedText(quote);
      if (comment) useComposerStore.getState().appendDraftText(comment);
    }
  });
  // A page (re)load wipes its annotations — the tab is idle again.
  chrome.tabs.onUpdated?.addListener((tabId: number, changeInfo: { status?: string }) => {
    if (changeInfo.status === 'loading' && useAnnotationStore.getState().byTab[tabId]) {
      useAnnotationStore.getState()._set(tabId, IDLE);
    }
  });
}
