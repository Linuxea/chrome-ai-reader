/**
 * Panel composition root: layout shell + the global wiring that legacy
 * main.ts/global-events did imperatively (init, tab activation, selection
 * relay, system-prompt sync) + the feature controllers' liftoff.
 */
import { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { Header } from './components/layout/Header';
import { QuickActions } from './components/layout/QuickActions';
import { Toasts } from './components/layout/Toasts';
import { TtsIndicator } from './components/layout/TtsIndicator';
import { MessageList } from './components/chat/MessageList';
import { Composer } from './components/composer/Composer';
import { Sheets } from './components/panels/Sheets';
import { ShareModal } from './components/panels/ShareModal';
import { QuizCard } from './components/panels/QuizCard';
import { PodcastCard } from './components/panels/PodcastCard';
import { PodcastMiniPlayer } from './components/panels/PodcastMiniPlayer';
import { useTabsStore } from './stores/tabs-store';
import { useUIStore } from './stores/ui-store';
import { initQuickActionHandler } from '@/panel/lib/quick-action-handler';
import { setExtractingNotifier } from '@/panel/lib/page-extractor';
import { submit } from './lib/send';
import { initTTS } from './lib/tts-controller';
import { initAnnotation } from './lib/annotation';
import { initPanelActions, setAskFocusHook } from './lib/panel-actions';
import { registerTTSStop, registerPodcastStop } from './lib/audio-resource';
import { stopAllTTS } from './lib/tts-controller';
import { stopPodcastAudioForTTS } from './lib/podcast-controller';
import { onSyncChange } from '@/platform/storage';
import * as core from '@/panel/state';

export default function App() {
  useEffect(() => {
    // The panel's toast store replaces the legacy toast stack for extraction.
    setExtractingNotifier(() => useUIStore.getState().pushToast('正在提取页面内容…'));
    // Quick actions go through the SAME submit pipeline as the send button.
    initQuickActionHandler({ submit });
    initTTS();
    initAnnotation();
    initPanelActions();
    setAskFocusHook(() => document.getElementById('userInput')?.focus());

    // Window-global audio takeover wiring (TTS ⇄ podcast). The podcast side
    // gets the buffer-preserving stop (pause + keep audio for replay/download).
    registerTTSStop(stopAllTTS);
    registerPodcastStop(stopPodcastAudioForTTS);

    void useTabsStore.getState().init();

    // The side panel belongs to one window; tab activations in other windows
    // must not swap this panel's conversation.
    let panelWindowId: number | undefined;
    void chrome.windows?.getCurrent?.().then(w => { panelWindowId = w.id; }).catch(() => { /* keep unfiltered */ });

    chrome.tabs.onActivated.addListener(async activeInfo => {
      if (panelWindowId !== undefined && activeInfo.windowId !== panelWindowId) return;
      if (activeInfo.tabId === core.getActiveTabId()) return;
      // The outgoing tab's generation keeps running in the background — its
      // isGenerating flag must survive the switch (store semantics keep it).
      await useTabsStore.getState().switchToTab(activeInfo.tabId);
    });

    // Selection relay from the content script → the quote preview bar.
    chrome.runtime.onMessage.addListener((msg: { action?: string; forwarded?: boolean; tabId?: number; text?: string }) => {
      if (msg.action !== 'selectionChanged' || !msg.forwarded) return;
      const tabId = core.getActiveTabId();
      if (tabId != null && msg.tabId && msg.tabId !== tabId) return;
      if (msg.text) useTabsStore.getState().setSelectedText(msg.text);
    });

    // Custom system prompt edits in the options page apply live.
    const offSystemPrompt = onSyncChange('systemPrompt', v => {
      useTabsStore.getState().setCustomSystemPrompt((v as string) || '');
    });

    return () => {
      offSystemPrompt();
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="panel-root">
        <Header />
        <QuickActions />
        <MessageList />
        <QuizCard />
        <PodcastCard />
        <Composer />
        <TtsIndicator />
        <PodcastMiniPlayer />
        <Sheets />
        <ShareModal />
        <Toasts />
      </div>
    </MotionConfig>
  );
}
