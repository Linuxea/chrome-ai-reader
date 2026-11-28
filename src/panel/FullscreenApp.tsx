/**
 * F17 fullscreen page — the same conversation, in a full browser tab
 * (opened from the side panel's detach button, live-synced through
 * lib/sync.ts). Layout: a ChatGPT-style shell — history sidebar on the
 * left (new chat on top, settings entry at the bottom), the chat column
 * on the right, centered at comfortable reading width.
 *
 * Every chat feature works unchanged: the page binds the conversation's
 * REAL tab id (URL param), so page extraction, citations, annotation and
 * immersive translation target the same page the side panel would.
 */
import { MotionConfig } from 'motion/react';
import { MessageSquarePlus, Moon, Sun, Settings as SettingsIcon, StickyNote } from 'lucide-react';
import { ConversationTitle } from './components/layout/Header';
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
import { HistoryList } from './components/panels/HistoryList';
import { usePanelLiftoff } from './hooks/usePanelLiftoff';
import { startNewChat } from '@/panel/lib/new-chat';
import { applyTheme, getThemeState } from '@/shared/theme';
import { useUIStore } from '@/panel/stores/ui-store';
import { t } from '@/shared/i18n.js';

export function FullscreenApp({ bindTabId }: { bindTabId: number }) {
  // Fullscreen semantics: bound to the conversation's tab (URL param) and
  // pinned to it — tab activations in the browser must not yank the chat.
  usePanelLiftoff({ bindTabId, followTabActivation: false, panelActions: false });

  const toggleTheme = () => {
    const { isDark, themeName } = getThemeState();
    applyTheme(!isDark, themeName, null);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="fs-root">
        <aside className="fs-sidebar">
          <div className="fs-brand">{t('app.title')}</div>
          <button className="fs-new-chat" onClick={() => startNewChat()}>
            <MessageSquarePlus size={16} />
            <span>{t('sidebar.newChat')}</span>
          </button>
          <div className="fs-history-head">{t('sidebar.history')}</div>
          <div className="fs-history">
            <HistoryList />
          </div>
          <div className="fs-sidebar-footer">
            <button className="icon-btn" title={t('notes.title')} onClick={() => useUIStore.getState().openSheet('notes')}>
              <StickyNote size={16} />
            </button>
            <button className="icon-btn" title={t('settings.toggleDark')} onClick={toggleTheme}>
              <Moon size={16} className="theme-icon-moon" />
              <Sun size={16} className="theme-icon-sun" />
            </button>
            <button className="fs-settings" onClick={() => void chrome.runtime.openOptionsPage()}>
              <SettingsIcon size={16} />
              <span>{t('sidebar.settings')}</span>
            </button>
          </div>
        </aside>

        <main className="fs-main">
          <header className="fs-main-head">
            <ConversationTitle />
          </header>
          <QuickActions />
          <TtsIndicator />
          <div className="fs-main-col">
            <MessageList />
            <QuizCard />
            <PodcastCard />
            <Composer />
          </div>
          <PodcastMiniPlayer />
        </main>

        <Sheets />
        <ShareModal />
        <Toasts />
      </div>
    </MotionConfig>
  );
}
