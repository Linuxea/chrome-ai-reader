import { motion } from 'motion/react';
import { useActiveTabState, useTabsStore } from '@/panel/stores/tabs-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { useStickToBottom } from '@/panel/hooks/useStickToBottom';
import { UserBubble } from './UserBubble';
import { AssistantBubble } from './AssistantBubble';
import { LiveAnswer } from './LiveAnswer';
import { useSuggestStore, fillDraftWith } from '@/panel/lib/suggest';
import { t } from '@/shared/i18n.js';

/**
 * The conversation surface — rendered purely from state: conversationHistory
 * (the single source of truth) + the live stream entry. The legacy
 * command式 rebuild (REQUEST_RERENDER / CHAT_RERENDERED / reattach) is
 * unnecessary: switching tabs swaps which state renders.
 */
export function MessageList() {
  useTabsStore(s => s.version);
  const tabState = useActiveTabState();
  const activeTabId = useTabsStore(s => s.activeTabId);
  const live = useStreamStore(s => (activeTabId != null ? s.streams[activeTabId] : undefined));
  const history = tabState?.conversationHistory ?? [];
  const ref = useStickToBottom<HTMLDivElement>([history.length, live?.answer, live?.thinking, live?.webSteps.length]);

  const empty = history.length === 0 && !live;

  return (
    // key={activeTabId}: a fresh scroll container per tab — the outgoing
    // tab's scroll offset / stick-to-bottom state must never leak into the
    // incoming one (legacy reset the scroll on every tab switch).
    <div className="chat-area" key={activeTabId ?? 'none'} ref={ref}>
      {empty && (
        <motion.div className="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <p>{t('sidebar.welcome')}</p>
        </motion.div>
      )}
      {history.map(msg =>
        msg.role === 'user'
          ? <UserBubble key={msg.id} msg={msg} tabState={tabState!} />
          : <AssistantBubble key={msg.id} msg={msg} tabId={activeTabId} />,
      )}
      {live && <LiveAnswer key={live.assistantId} live={live} />}
      <SuggestChips tabId={activeTabId} />
    </div>
  );
}

function SuggestChips({ tabId }: { tabId: number | null }) {
  const entry = useSuggestStore(s => (tabId != null ? s.byTab[tabId] : undefined));
  if (!entry) return null;
  if (entry.loading) {
    return (
      <div className="suggest-loading" aria-label="loading suggestions">
        <span className="suggest-bar" />
        <span className="suggest-bar" />
        <span className="suggest-bar" />
      </div>
    );
  }
  if (entry.questions.length === 0) return null;
  return (
    <div className="suggest-questions">
      {entry.questions.map(q => (
        <button key={q} className="suggest-item" onClick={() => fillDraftWith(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}
