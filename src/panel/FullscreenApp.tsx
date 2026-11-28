/**
 * F17 fullscreen page — the same conversation, in a full browser tab
 * (opened from the side panel's detach button, live-synced through
 * lib/sync.ts). Layout: a ChatGPT-style shell — history sidebar on the
 * left (new chat on top, settings entry at the bottom), the chat column
 * on the right, centered at comfortable reading width.
 *
 * This surface is a PURE chat (`lib/surface.ts`): it never grounds its
 * requests on the linked page — no extraction, no article, no citation
 * rule, and none of the page-reading features (quick actions, quiz,
 * podcast, annotation, immersive translation, page capture) render here;
 * those live in the side panel, attached to the page. The conversation's
 * history still contains whatever the side panel asked before the detach,
 * and TTS / web search / suggestions work as anywhere else.
 */
import { MotionConfig } from 'motion/react';
import { MessageSquarePlus, Moon, Sun, Settings as SettingsIcon, StickyNote } from 'lucide-react';
import { ConversationTitle } from './components/layout/Header';
import { Toasts } from './components/layout/Toasts';
import { TtsIndicator } from './components/layout/TtsIndicator';
import { MessageList } from './components/chat/MessageList';
import { Composer } from './components/composer/Composer';
import { Sheets } from './components/panels/Sheets';
import { ShareModal } from './components/panels/ShareModal';
import { HistoryList } from './components/panels/HistoryList';
import { usePanelLiftoff } from './hooks/usePanelLiftoff';
import { startNewChat } from '@/panel/lib/new-chat';
import { markFullscreenSurface } from '@/panel/lib/surface';
import { applyTheme, getThemeState } from '@/shared/theme';
import { useUIStore } from '@/panel/stores/ui-store';
import { t } from '@/shared/i18n.js';

export function FullscreenApp({ bindTabId }: { bindTabId: number }) {
  // Rendering the fullscreen surface IS the mark: the send pipeline and the
  // composer read it (no page grounding, no page capture). Idempotent.
  markFullscreenSurface();

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
          <TtsIndicator />
          <div className="fs-main-col">
            <MessageList />
            <Composer />
          </div>
        </main>

        <Sheets />
        <ShareModal />
        <Toasts />
      </div>
    </MotionConfig>
  );
}
