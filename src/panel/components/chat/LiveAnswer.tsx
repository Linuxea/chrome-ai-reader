import { useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, Settings, Ban } from 'lucide-react';
import type { ChatMessage } from '@/shared/types';
import type { LiveStream } from '@/panel/stores/stream-store';
import { useThrottledText } from '@/panel/hooks/useThrottledText';
import { MarkdownView } from './MarkdownView';
import { WebTraceView } from './WebTraceView';
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
  // A running web search is activity too: it replaces the typing indicator
  // with its own "searching…" line.
  const started = live.thinking !== '' || live.answer !== '' || live.webSteps.length > 0;

  // A failed send: the user bubble renders as its own right-aligned turn
  // (like any user message) with the error card below it.
  if (live.status === 'error') {
    return (
      <>
        {live.failedUserMessage && <FailedUserBubble msg={live.failedUserMessage} />}
        <div className="ai-msg">
          {live.webSteps.length > 0 && <WebTraceView steps={live.webSteps} />}
          <ErrorCard live={live} />
        </div>
      </>
    );
  }

  // Stopped before any answer text: the kept user turn (retryable) + note.
  if (live.status === 'aborted') {
    return (
      <>
        {live.failedUserMessage && <FailedUserBubble msg={live.failedUserMessage} retryable />}
        <div className="msg-note">{live.note}</div>
      </>
    );
  }

  return (
    <div className="ai-msg">
      <WebTraceView steps={live.webSteps} live />
      {/* One slot for the whole stream: the block must stay mounted when the
          answer starts — a remount would reset its state and re-open what the
          auto-collapse just closed. It collapses once the answer text begins. */}
      {live.thinking !== '' && <ThinkingBlock text={live.thinking} live answerStarted={live.answer !== ''} />}
      {!started && (
        <div className="ai-msg-pending">
          <TypingIndicator />
        </div>
      )}
      {throttled !== '' && (
        <>
          <MarkdownView text={throttled} />
          {streaming && <span className="stream-cursor" aria-hidden />}
        </>
      )}
    </div>
  );
}

function FailedUserBubble({ msg, retryable }: { msg: ChatMessage; retryable?: boolean }) {
  return (
    <div className="user-msg-group">
      <div className="user-bubble failed-user" data-msg-id={msg.id}>
        {msg.meta?.quote && <blockquote className="bubble-quote">{msg.meta.quote}</blockquote>}
        <div className="bubble-text">{msg.meta?.displayText ?? (typeof msg.content === 'string' ? msg.content : '')}</div>
      </div>
      {retryable && (
        <div className="user-actions visible">
          <button className="icon-mini" title={t('action.retry')} onClick={() => void retryMessage(msg)}>
            <RotateCcw size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function ErrorCard({ live }: { live: LiveStream }) {
  const [retrying, setRetrying] = useState(false);
  const failed = live.failedUserMessage;
  // Key-driven (not translated-text comparison): survives language switches.
  const configError = live.errorKey === 'error.noApiKey' || live.errorKey === 'error.noModelName';
  return (
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
  );
}
