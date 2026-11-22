import { MessageSquarePlus, Moon, Sun, Settings as SettingsIcon, History, StickyNote } from 'lucide-react';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { saveCurrentChat } from '@/panel/lib/chat-save';
import { removeSuggestions } from '@/panel/lib/suggest';
import { applyTheme, getThemeState } from '@/shared/theme';
import { t } from '@/shared/i18n.js';

/**
 * Panel header: new chat (legacy semantics: busy guard, save the outgoing
 * conversation, clear page cache + history + quote), sheets, theme, settings.
 */
export function Header() {
  const isGenerating = useTabsStore(s => s.isGenerating);
  const sheet = useUIStore(s => s.sheet);
  const openSheet = useUIStore(s => s.openSheet);

  const newChat = () => {
    const store = useTabsStore.getState();
    if (isGenerating) {
      useUIStore.getState().pushToast(t('toast.busyGenerating'));
      return;
    }
    void saveCurrentChat();
    // Legacy newChat also dropped the outgoing conversation's suggestion
    // chips and pending image previews — they must not leak into the new
    // chat (a stray chip would fill the input with the OLD page's question;
    // a pending image would silently ride the new chat's first message).
    const tabId = store.activeTabId;
    if (tabId != null) removeSuggestions(tabId);
    useComposerStore.setState({ images: [], tabs: [] });
    store.setPageContent('');
    store.setPageExcerpt('');
    store.setPageTitle('');
    store.clearConversation();
    store.setCurrentChatId(null);
    store.setSelectedText('');
  };

  const toggleTheme = () => {
    const { isDark, themeName } = getThemeState();
    applyTheme(!isDark, themeName, null);
  };

  return (
    <header className="panel-header">
      <h1 className="panel-title">小🍐子</h1>
      <div className="header-actions">
        <button className={`icon-btn${sheet === 'history' ? ' active' : ''}`} title={t('sidebar.history')} onClick={() => openSheet('history')}>
          <History size={16} />
        </button>
        <button className={`icon-btn${sheet === 'notes' ? ' active' : ''}`} title={t('notes.title')} onClick={() => openSheet('notes')}>
          <StickyNote size={16} />
        </button>
        <button className="icon-btn" title={t('sidebar.newChat')} onClick={newChat}>
          <MessageSquarePlus size={16} />
        </button>
        <button className="icon-btn" title={t('settings.toggleDark')} onClick={toggleTheme}>
          <Moon size={16} className="theme-icon-moon" />
          <Sun size={16} className="theme-icon-sun" />
        </button>
        <button className="icon-btn" title={t('sidebar.settings')} onClick={() => void chrome.runtime.openOptionsPage()}>
          <SettingsIcon size={16} />
        </button>
      </div>
    </header>
  );
}
