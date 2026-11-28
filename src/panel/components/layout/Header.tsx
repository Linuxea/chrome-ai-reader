import { useState } from 'react';
import { MessageSquarePlus, Moon, Sun, Settings as SettingsIcon, History, StickyNote, Maximize2 } from 'lucide-react';
import { useTabsStore, useActiveTabState } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { startNewChat } from '@/panel/lib/new-chat';
import { openFullscreenChat } from '@/panel/lib/fullscreen';
import { syncChatTitleToRecord } from '@/panel/lib/chat-save';
import { applyTheme, getThemeState } from '@/shared/theme';
import { t } from '@/shared/i18n.js';

/**
 * Panel header. F16: the header shows the CONVERSATION's title (generated
 * after the first exchange, renamable by clicking) — not the app name, which
 * Chrome's side-panel toolbar already displays. F17: the leading action
 * detaches the conversation into a fullscreen tab (live-synced back).
 */
export function Header() {
  const sheet = useUIStore(s => s.sheet);
  const openSheet = useUIStore(s => s.openSheet);

  const newChat = () => startNewChat();

  const toggleTheme = () => {
    const { isDark, themeName } = getThemeState();
    applyTheme(!isDark, themeName, null);
  };

  return (
    <header className="panel-header">
      <ConversationTitle />
      <div className="header-actions">
        <button className="icon-btn" title={t('fs.open')} onClick={() => void openFullscreenChat()}>
          <Maximize2 size={16} />
        </button>
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

/**
 * The conversation's title in the header: the tab's `chatTitle`, with the
 * i18n "new chat" placeholder until one exists. Click to rename inline —
 * Enter (IME-guarded) or blur commits, Escape cancels; an empty commit is a
 * cancel. A rename is the user's word for the conversation: it writes the
 * same field generation writes, so nothing overwrites it afterwards.
 * F17: exported — the fullscreen page's top bar reuses it verbatim.
 */
export function ConversationTitle() {
  const tabState = useActiveTabState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const chatTitle = tabState?.chatTitle?.trim() ?? '';
  const display = chatTitle || t('chat.newChat');

  const startEdit = () => {
    setDraft(chatTitle);
    setEditing(true);
  };

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const value = draft.trim();
    if (!value || value === chatTitle) return;
    const store = useTabsStore.getState();
    store.setChatTitle(value);
    // A rename must reach the saved record even if the user never sends
    // another message — later saves would carry it, but the history list
    // should not wait for those.
    if (store.activeTabId != null) syncChatTitleToRecord(store.activeTabId);
  };

  return (
    <h1 className="panel-title" title={display}>
      {editing ? (
        <input
          className="panel-title-input"
          value={draft}
          autoFocus
          maxLength={60}
          aria-label={t('chat.rename')}
          onChange={e => setDraft(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={commit}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button className="panel-title-btn" onClick={startEdit} title={display} aria-label={t('chat.rename')}>
          {display}
        </button>
      )}
    </h1>
  );
}
