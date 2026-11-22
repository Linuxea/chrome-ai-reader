import { useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, Settings, Ban } from 'lucide-react';
import type { LiveStream } from '@/panel/stores/stream-store';
import { useThrottledText } from '@/panel/hooks/useThrottledText';
import { MarkdownView } from './MarkdownView';
import { AgentTraceView } from './AgentTraceView';
import { TypingIndicator } from './TypingIndicator';
import { ThinkingBlock } from './AssistantBubble';
import { retryMessage } from '@/panel/lib/send';
import { openOptionsPage } from '@/platform/messaging';
import { t } from '@/shared/i18n.js';

/**
 * The live, in-flight answer (stream-store driven). Replaces the legacy
 * appended-bubble + reattach machinery: wherever this tab is active, the
 * entry renders; outcomes render as an error card / quiet note.
 */
export function LiveAnswer({ live }: { live: LiveStream }) {
  const throttled = useThrottledText(live.answer);
  const streaming = live.status === 'streaming';
  const started = live.thinking !== '' || live.answer !== '' || live.rounds.length > 0;

  return (
    <div className="ai-msg">
      {streaming && <AgentTraceView rounds={live.rounds} />}
      {live.status === 'error' && live.failedUserMessage?.agentTrace && (
        <AgentTraceView steps={live.failedUserMessage.agentTrace} />
      )}
      {streaming && live.answer === '' && <ThinkingBlock text={live.thinking} />}
      {streaming && !started && (
        <div className="ai-msg-pending">
          <TypingIndicator />
        </div>
      )}
      {(streaming || live.answer !== '') && throttled !== '' && (
        <>
          {streaming && live.answer !== '' && live.thinking !== '' && <ThinkingBlock text={live.thinking} />}
          <MarkdownView text={throttled} />
          {streaming && <span className="stream-cursor" aria-hidden />}
        </>
      )}
      {live.status === 'error' && <ErrorCard live={live} />}
      {live.status === 'aborted' && <div className="msg-note">{live.note}</div>}
    </div>
  );
}

function ErrorCard({ live }: { live: LiveStream }) {
  const [retrying, setRetrying] = useState(false);
  const failed = live.failedUserMessage;
  const configError = live.error === t('error.noApiKey') || live.error === t('error.noModelName');
  return (
    <>
      {failed && (
        <div className="user-bubble failed-user" data-msg-id={failed.id}>
          {failed.meta?.quote && <blockquote className="bubble-quote">{failed.meta.quote}</blockquote>}
          <div className="bubble-text">{failed.meta?.displayText ?? (typeof failed.content === 'string' ? failed.content : '')}</div>
        </div>
      )}
      <motion.div
        className="error-card"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        role="alert"
      >
        <Ban size={14} className="error-icon" />
        <span className="error-text">{live.error}</span>
        <span className="error-actions">
          {failed && (
            <button
              className="btn-ghost"
              disabled={retrying}
              onClick={() => { setRetrying(true); void retryMessage(failed); }}
            >
              <RotateCcw size={13} /> {t('action.retry')}
            </button>
          )}
          {configError && (
            <button className="btn-ghost" onClick={() => void openOptionsPage()}>
              <Settings size={13} /> {t('action.openSettings')}
            </button>
          )}
        </span>
      </motion.div>
    </>
  );
}
