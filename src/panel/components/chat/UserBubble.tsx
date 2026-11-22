import { memo, useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, Pencil, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ChatMessage, TabState } from '@/shared/types';
import { branchInfo, ROOT_BRANCH } from '@/panel/lib/history-ops';
import { retryMessage, editMessage } from '@/panel/lib/send';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { t } from '@/shared/i18n.js';

/**
 * A user turn, rendered purely from message DATA (meta + content parts):
 * display text, quote, attached-tab chips, image thumbnails. Retry / edit
 * re-send from this data — the legacy DOM-teardown rescue is gone.
 */
export const UserBubble = memo(function UserBubble({ msg, tabState }: { msg: ChatMessage; tabState: TabState }) {
  const meta = msg.meta;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const images = imageUris(msg);

  // Branch switcher: shown on the first message after a fork anchor when
  // more than one continuation exists (‹ n/m ›).
  const histIdx = tabState.conversationHistory.indexOf(msg);
  const anchor = histIdx > 0 ? (tabState.conversationHistory[histIdx - 1]!.id ?? ROOT_BRANCH) : ROOT_BRANCH;
  const info = branchInfo(tabState, anchor);

  return (
    <motion.div
      className="user-msg-group"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="user-bubble" data-msg-id={msg.id}>
        {images.length > 0 && (
          <div className="bubble-images">
            {images.map((uri, i) => (
              <img key={i} src={uri} alt="" className="bubble-image" />
            ))}
          </div>
        )}
        {editing ? (
          <div className="bubble-edit">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="bubble-edit-actions">
              <button
                className="btn-ghost"
                onClick={() => {
                  const text = draft.trim();
                  if (text) void editMessage(msg, text);
                  setEditing(false);
                }}
              >
                <Check size={14} /> {t('action.edit.save')}
              </button>
              <button className="btn-ghost" onClick={() => setEditing(false)}>
                <X size={14} /> {t('action.edit.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {meta?.quote && <blockquote className="bubble-quote">{meta.quote}</blockquote>}
            {meta?.tabs && meta.tabs.length > 0 && (
              <div className="bubble-tabs">
                {meta.tabs.map(tab => (
                  <span key={tab.id} className="bubble-tab-chip" title={tab.url}>{tab.title}</span>
                ))}
              </div>
            )}
            <div className="bubble-text">{meta?.displayText ?? textOf(msg)}</div>
          </>
        )}
      </div>
      <div className="user-actions">
        <button className="icon-mini" title={t('action.edit')} onClick={() => { setDraft(meta?.rawText ?? textOf(msg)); setEditing(true); }}>
          <Pencil size={13} />
        </button>
        <button className="icon-mini" title={t('action.retry')} onClick={() => void retryMessage(msg)}>
          <RotateCcw size={13} />
        </button>
        {info && (
          <span className="branch-switcher">
            <button
              className="icon-mini"
              disabled={info.index <= 1}
              onClick={() => useTabsStore.getState().switchBranch(anchor, info!.index - 2)}
              title={t('action.prevBranch')}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="branch-pos">{info.index}/{info.total}</span>
            <button
              className="icon-mini"
              disabled={info.index >= info.total}
              onClick={() => useTabsStore.getState().switchBranch(anchor, info!.index)}
              title={t('action.nextBranch')}
            >
              <ChevronRight size={13} />
            </button>
          </span>
        )}
      </div>
    </motion.div>
  );
});

function imageUris(msg: ChatMessage): string[] {
  if (typeof msg.content === 'string') return [];
  return msg.content.filter(p => p.type === 'image_url').map(p => (p.type === 'image_url' ? p.image_url.url : ''));
}

function textOf(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content.filter(p => p.type === 'text').map(p => (p.type === 'text' ? p.text : '')).join('\n');
}
