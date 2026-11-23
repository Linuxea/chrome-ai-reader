import { memo, useEffect, useState } from 'react';
import type { ChatMessage } from '@/shared/types';
import { MarkdownView } from './MarkdownView';
import { AgentTraceView } from './AgentTraceView';
import { WebTraceView } from './WebTraceView';
import { AnswerActions } from './AnswerActions';
import { useUIStore } from '@/panel/stores/ui-store';
import { t } from '@/shared/i18n.js';

/** A finished assistant answer, rendered from history (markdown + trace + notes + actions). */
export const AssistantBubble = memo(function AssistantBubble({ msg, tabId }: { msg: ChatMessage; tabId?: number | null }) {
  const text = typeof msg.content === 'string' ? msg.content : '';
  const openShare = useUIStore(s => s.openShare);
  return (
    <div className="ai-msg" data-msg-id={msg.id}>
      {msg.agentTrace && msg.agentTrace.length > 0 && <AgentTraceView steps={msg.agentTrace} />}
      {/* F15: the searches this answer used, and its cited sources as chips. */}
      {msg.web && <WebTraceView steps={msg.web.steps} />}
      {/* The answer's reasoning, kept as a collapsed summary the user can open. */}
      {msg.reasoning && <ThinkingBlock text={msg.reasoning} />}
      <MarkdownView text={text} web={msg.web} />
      {msg.finish?.reason === 'length' && (
        <div className="msg-note">
          {msg.finish.limit === 'steps' ? t('agent.stepLimit') : t('ai.truncatedByLimit')}
        </div>
      )}
      {msg.finish?.reason === 'refusal' && <div className="msg-note">{t('ai.refusedPartway')}</div>}
      {msg.finish?.usage && (
        <div className="answer-usage">
          {t('ai.usage', {
            model: msg.finish.model ?? '',
            in: String(msg.finish.usage.inputTokens),
            out: String(msg.finish.usage.outputTokens),
          })}
        </div>
      )}
      <AnswerActions msgId={msg.id ?? ''} markdown={text} tabId={tabId ?? null} onShare={() => openShare(msg.id ?? '')} />
    </div>
  );
});

/**
 * Collapsible reasoning block.
 *
 * Live: open while the reasoning is the only thing streaming, collapsed
 * ONCE the answer text starts (`answerStarted`) — the user may re-open it
 * while the answer streams. Saved: a collapsed summary above the answer
 * (it used to vanish the moment the answer completed).
 *
 * `open` is state rather than just the <details> attribute so that the
 * one-time collapse cannot re-close a block the user re-opened later.
 */
export function ThinkingBlock({ text, live = false, answerStarted = false }: { text: string; live?: boolean; answerStarted?: boolean }) {
  const [open, setOpen] = useState(live && !answerStarted);
  useEffect(() => {
    if (answerStarted) setOpen(false);
  }, [answerStarted]);
  if (!text) return null;
  return (
    <details className="thinking-block" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="thinking-summary">{t('ai.thinking')}</summary>
      <div className="thinking-content">
        <MarkdownView text={text} />
      </div>
    </details>
  );
}
