import { useEffect, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import { useActiveTabState } from '@/panel/stores/tabs-store';
import { listChatHistory, loadChat, deleteChatById, type ChatHistoryEntry } from '@/panel/lib/chat-save';
import { formatDate } from '@/shared/format';
import { t } from '@/shared/i18n.js';

/**
 * The saved-chat list — one implementation for both surfaces (the side
 * panel's history sheet, F17's fullscreen sidebar). Two-step delete (the
 * legacy armed pattern): the first click lights the button up, only the
 * second within the window deletes. IndexedDB has no undo — a stray click
 * must not destroy a saved conversation.
 */
export function HistoryList({ onLoaded }: { onLoaded?: () => void } = {}) {
  const [chats, setChats] = useState<ChatHistoryEntry[] | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  // The active conversation is highlighted so both surfaces agree on
  // "which chat am I in".
  const activeChatId = useActiveTabState()?.currentChatId ?? null;

  useEffect(() => {
    if (armedId == null) return;
    const timer = setTimeout(() => setArmedId(null), 2500);
    return () => clearTimeout(timer);
  }, [armedId]);

  const refresh = () => { void listChatHistory().then(setChats); };
  useEffect(refresh, []);

  if (chats === null) return <div className="sheet-empty">…</div>;
  if (chats.length === 0) return <div className="sheet-empty">{t('sidebar.historyEmpty')}</div>;

  return (
    <>
      {chats.map(chat => (
        <div key={chat.id} className="history-item">
          <button
            className={`history-item-main${chat.id === activeChatId ? ' active' : ''}`}
            onClick={() => { void loadChat(chat.id).then(ok => { if (ok) onLoaded?.(); }); }}
          >
            <MessageSquare size={13} className="history-item-icon" />
            <span className="history-item-title">{chat.title}</span>
            <span className="history-item-date">{formatDate(chat.updatedAt)}</span>
          </button>
          <button
            className={`icon-mini delete-confirm${armedId === chat.id ? ' armed' : ''}`}
            title={armedId === chat.id ? t('action.delete') : ''}
            onClick={() => {
              if (armedId === chat.id) {
                setArmedId(null);
                void deleteChatById(chat.id).then(refresh);
              } else {
                setArmedId(chat.id);
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </>
  );
}
