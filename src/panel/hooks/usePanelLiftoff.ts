/**
 * Panel liftoff — the bootstrap both surfaces share (the side panel and
 * the F17 fullscreen tab): controller init, window-global audio wiring,
 * cross-surface sync, the selection relay and the live system-prompt
 * sync. Extracted from App.tsx (F17) so the fullscreen page starts with
 * byte-identical semantics.
 *
 * What each surface opts into:
 * - side panel: follows tab activations (with a skip for the fullscreen
 *   tab itself — activating it must not blank this panel) and consumes
 *   the F8 context-menu action queue;
 * - fullscreen tab: binds the conversation's tab (its URL param — itself
 *   being a tab, the active-tab query would resolve to ITSELF) and stays
 *   pinned to it.
 */
import { useEffect } from 'react';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { initQuickActionHandler } from '@/panel/lib/quick-action-handler';
import { setExtractingNotifier } from '@/panel/lib/page-extractor';
import { submit } from '@/panel/lib/send';
import { initTTS } from '@/panel/lib/tts-controller';
import { initAnnotation } from '@/panel/lib/annotation';
import { initPanelActions, setAskFocusHook } from '@/panel/lib/panel-actions';
import { registerTTSStop, registerPodcastStop } from '@/panel/lib/audio-resource';
import { stopAllTTS } from '@/panel/lib/tts-controller';
import { stopPodcastAudioForTTS } from '@/panel/lib/podcast-controller';
import { installStateSync, adoptStoredInFlightFlag } from '@/panel/lib/sync';
import { fullscreenLinkedTabOf } from '@/panel/lib/fullscreen';
import { onSyncChange } from '@/platform/storage';
import { t } from '@/shared/i18n.js';
import * as core from '@/panel/state';

export interface PanelLiftoffOptions {
  /** Bind this surface to an explicit tab id (the fullscreen page's URL param). */
  bindTabId?: number;
  /** Follow tab activations — the side panel does; the fullscreen page is pinned. */
  followTabActivation?: boolean;
  /** Consume the F8 context-menu action queue — the side panel only. */
  panelActions?: boolean;
}

export function usePanelLiftoff(opts: PanelLiftoffOptions = {}): void {
  const { bindTabId, followTabActivation = true, panelActions = true } = opts;

  useEffect(() => {
    // The panel's toast store replaces the legacy toast stack for extraction.
    setExtractingNotifier(() => useUIStore.getState().pushToast(t('toast.extracting')));
    // Quick actions go through the SAME submit pipeline as the send button.
    initQuickActionHandler({ submit });
    initTTS();
    initAnnotation();
    setAskFocusHook(() => document.getElementById('userInput')?.focus());

    // Window-global audio takeover wiring (TTS ⇄ podcast). The podcast side
    // gets the buffer-preserving stop (pause + keep audio for replay/download).
    registerTTSStop(stopAllTTS);
    registerPodcastStop(stopPodcastAudioForTTS);

    // F17: mirror every other surface bound to this tab (the side panel ⇄
    // the fullscreen tab) — state changes, live streams, stops.
    const offSync = installStateSync();

    const onRuntimeMessage = (msg: { action?: string; forwarded?: boolean; tabId?: number; text?: string }) => {
      if (msg.action !== 'selectionChanged' || !msg.forwarded) return;
      const tabId = core.getActiveTabId();
      if (tabId != null && msg.tabId && msg.tabId !== tabId) return;
      if (msg.text) useTabsStore.getState().setSelectedText(msg.text);
    };

    // The side panel belongs to one window; tab activations in other windows
    // must not swap this panel's conversation.
    let panelWindowId: number | undefined;
    const onActivated = async (activeInfo: { tabId: number; windowId: number }) => {
      if (panelWindowId !== undefined && activeInfo.windowId !== panelWindowId) return;
      if (activeInfo.tabId === core.getActiveTabId()) return;
      // F17: the fullscreen chat tab is this conversation's OTHER window, not
      // a new conversation — activating it must not blank this panel.
      if (await fullscreenLinkedTabOf(activeInfo.tabId) != null) return;
      // The outgoing tab's generation keeps running in the background — its
      // isGenerating flag must survive the switch (store semantics keep it).
      await useTabsStore.getState().switchToTab(activeInfo.tabId);
    };

    if (followTabActivation) {
      void chrome.windows?.getCurrent?.().then(w => { panelWindowId = w.id; }).catch(() => { /* keep unfiltered */ });
      chrome.tabs.onActivated.addListener(onActivated);
    }
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    // Custom system prompt edits in the options page apply live.
    const offSystemPrompt = onSyncChange('systemPrompt', v => {
      useTabsStore.getState().setCustomSystemPrompt((v as string) || '');
    });

    // F8 panel actions MUST start AFTER init(): a queued context-menu action
    // is checked against the active tab, which initState resolves — reading
    // it earlier silently drops the action (legacy awaited init too).
    // The fullscreen page never consumes the queue: the context menu opens
    // the SIDE panel; a fullscreen tab eating the TTL-guarded action would
    // leave the panel with nothing to run.
    let cancelled = false;
    void useTabsStore.getState().init(bindTabId).then(async () => {
      if (cancelled) return;
      const tabId = core.getActiveTabId();
      if (tabId != null) {
        // F17: a stored in-flight flag may belong to a LIVE sibling surface
        // (this panel just opened mid-answer) — adopt it; a stale one (dead
        // writer) is released by the stop button's self-heal.
        await adoptStoredInFlightFlag(tabId);
        if (cancelled) return;
        // The panel may have opened while the FULLSCREEN tab was focused —
        // tabs.query resolved to that page. Bind the conversation's tab
        // (the fullscreen URL carries it) instead of the empty page state.
        const linked = await fullscreenLinkedTabOf(tabId);
        if (!cancelled && linked != null && linked !== tabId) {
          await useTabsStore.getState().switchToTab(linked);
        }
      }
      if (!cancelled && panelActions) initPanelActions();
    });

    return () => {
      cancelled = true;
      if (followTabActivation) chrome.tabs.onActivated.removeListener(onActivated);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      offSystemPrompt();
      offSync();
    };
    // Liftoff is once-per-page; opts values are read inside for clarity only.
  }, []);
}
